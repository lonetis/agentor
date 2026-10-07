import type { GitBranchList, GitRepoInfo } from '../../shared/types';
import { GitHostingClient } from './git-hosting-client';
import { useLogger } from './services';

interface ApiProject {
  path_with_namespace: string;
  visibility: 'public' | 'internal' | 'private';
  default_branch: string | null;
}

function toRepo(p: ApiProject): GitRepoInfo {
  // `internal` projects are visible to every signed-in user of the instance —
  // still not public, so they count as private here.
  return { fullName: p.path_with_namespace, private: p.visibility !== 'public', defaultBranch: p.default_branch ?? '' };
}

/** GitLab REST API (v4) client for gitlab.com or a self-managed instance,
 * bound to one user token (personal, group/project or OAuth access token). */
export class GitLabService extends GitHostingClient {
  private get api(): string {
    return `${this.provider.url}/api/v4`;
  }

  getUsername(): Promise<string> {
    return this.cached('user', async () => (await this.request<{ username: string }>(`${this.api}/user`)).username);
  }

  listRepos(): Promise<GitRepoInfo[]> {
    return this.cached('repos', async () => {
      const repos = (await this.fetchAllPages<ApiProject>(
        `${this.api}/projects?membership=true&simple=true&order_by=id&sort=asc&per_page=100`,
      )).map(toRepo).sort((a, b) => a.fullName.localeCompare(b.fullName));
      useLogger().debug(`${this.logTag} fetched ${repos.length} projects`);
      return repos;
    });
  }

  /** Groups where the user is at least a Developer — the lowest role GitLab can
   * allow to create projects (the group's own setting decides). */
  listNamespaces(): Promise<string[]> {
    return this.cached('groups', async () =>
      (await this.fetchAllPages<{ full_path: string }>(`${this.api}/groups?min_access_level=30&per_page=100`))
        .map((g) => g.full_path)
        .sort((a, b) => a.localeCompare(b)),
    );
  }

  listBranches(fullName: string): Promise<GitBranchList> {
    const project = encodeProjectPath(fullName);
    return this.cached(`branches:${fullName}`, async () => {
      const [info, branches] = await Promise.all([
        this.request<ApiProject>(`${this.api}/projects/${project}`),
        this.fetchAllPages<{ name: string }>(`${this.api}/projects/${project}/repository/branches?per_page=100`),
      ]);
      return { branches: branches.map((b) => ({ name: b.name })), defaultBranch: info.default_branch ?? '' };
    });
  }

  async createRepo(namespace: string, name: string, isPrivate: boolean): Promise<GitRepoInfo> {
    const body: Record<string, unknown> = { name, path: name, visibility: isPrivate ? 'private' : 'public' };
    // Omitting namespace_id creates the project in the user's personal namespace.
    if (namespace !== await this.getUsername()) {
      const ns = await this.request<{ id: number }>(`${this.api}/namespaces/${encodeURIComponent(namespace)}`);
      body.namespace_id = ns.id;
    }
    useLogger().info(`${this.logTag} creating project ${namespace}/${name} (private=${isPrivate})`);
    const repo = toRepo(await this.request<ApiProject>(`${this.api}/projects`, { method: 'POST', body }));
    this.invalidate('repos');
    useLogger().info(`${this.logTag} created project ${repo.fullName}`);
    return repo;
  }

  protected headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}`, Accept: 'application/json' };
  }

  /** Follows `X-Next-Page` on our own URL rather than the `Link` header: GitLab
   * builds `Link` from its configured external URL, which on self-managed
   * instances often differs from the URL the orchestrator reaches it at. */
  protected nextPageUrl(res: Response, url: string): string | null {
    const next = res.headers.get('x-next-page');
    if (!next) return null;
    const u = new URL(url);
    u.searchParams.set('page', next);
    return u.toString();
  }
}

/** `group/sub/project` → URL-encoded project id (`group%2Fsub%2Fproject`). */
function encodeProjectPath(fullName: string): string {
  const parts = fullName.split('/');
  if (parts.length < 2 || parts.some((p) => !p)) {
    throw createError({ statusCode: 400, statusMessage: `Invalid GitLab project "${fullName}" — expected group/project` });
  }
  return encodeURIComponent(fullName);
}
