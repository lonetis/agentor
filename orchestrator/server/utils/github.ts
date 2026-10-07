import type { GitBranchList, GitRepoInfo } from '../../shared/types';
import { GitHostingClient } from './git-hosting-client';
import { useLogger } from './services';

const API = 'https://api.github.com';

interface ApiRepo {
  full_name: string;
  private: boolean;
  default_branch: string;
}

function toRepo(r: ApiRepo): GitRepoInfo {
  return { fullName: r.full_name, private: r.private, defaultBranch: r.default_branch };
}

/** GitHub REST API client bound to one user token (from the provider's
 * `tokenEnvVar` in the user's env vars). */
export class GitHubService extends GitHostingClient {
  getUsername(): Promise<string> {
    return this.cached('user', async () => (await this.request<{ login: string }>(`${API}/user`)).login);
  }

  listRepos(): Promise<GitRepoInfo[]> {
    return this.cached('repos', async () => {
      const repos = (await this.fetchAllPages<ApiRepo>(
        `${API}/user/repos?per_page=100&sort=full_name&affiliation=owner,collaborator,organization_member`,
      )).map(toRepo);
      useLogger().debug(`${this.logTag} fetched ${repos.length} repos`);
      return repos;
    });
  }

  listNamespaces(): Promise<string[]> {
    return this.cached('orgs', async () =>
      (await this.fetchAllPages<{ login: string }>(`${API}/user/orgs?per_page=100`)).map((o) => o.login),
    );
  }

  listBranches(fullName: string): Promise<GitBranchList> {
    const repoPath = encodeRepoPath(fullName);
    return this.cached(`branches:${fullName}`, async () => {
      const [repo, branches] = await Promise.all([
        this.request<{ default_branch: string }>(`${API}/repos/${repoPath}`),
        this.fetchAllPages<{ name: string }>(`${API}/repos/${repoPath}/branches?per_page=100`),
      ]);
      return { branches: branches.map((b) => ({ name: b.name })), defaultBranch: repo.default_branch };
    });
  }

  async createRepo(namespace: string, name: string, isPrivate: boolean): Promise<GitRepoInfo> {
    const isOrg = namespace !== await this.getUsername();
    const url = isOrg ? `${API}/orgs/${encodeURIComponent(namespace)}/repos` : `${API}/user/repos`;
    useLogger().info(`${this.logTag} creating repo ${namespace}/${name} (private=${isPrivate}, org=${isOrg})`);
    const repo = toRepo(await this.request<ApiRepo>(url, { method: 'POST', body: { name, private: isPrivate } }));
    this.invalidate('repos');
    useLogger().info(`${this.logTag} created repo ${repo.fullName}`);
    return repo;
  }

  protected headers(): Record<string, string> {
    return {
      Authorization: `token ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  protected nextPageUrl(res: Response): string | null {
    const match = res.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/);
    return match?.[1] ?? null;
  }
}

/** `owner/repo` → `owner/repo` with each segment URL-encoded. */
function encodeRepoPath(fullName: string): string {
  const parts = fullName.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw createError({ statusCode: 400, statusMessage: `Invalid GitHub repository "${fullName}" — expected owner/repo` });
  }
  return parts.map(encodeURIComponent).join('/');
}
