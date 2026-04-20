export interface GitHubRepo {
  fullName: string;
  private: boolean;
  defaultBranch: string;
}

export interface GitHubBranch {
  name: string;
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const CACHE_TTL = 60_000; // 60s

/** Per-token GitHub API wrapper. Tokens come from individual users'
 * `UserEnvVars.githubToken`. Instances are cached by token so repeated calls
 * within 60s reuse the same upstream data. */
export class GitHubService {
  private token: string;
  private cache = new Map<string, CacheEntry<unknown>>();

  constructor(token: string) {
    this.token = token;
  }

  get hasToken(): boolean {
    return this.token.length > 0;
  }

  async listRepos(): Promise<GitHubRepo[]> {
    const cached = this.getCache<GitHubRepo[]>('repos');
    if (cached) return cached;

    const url = 'https://api.github.com/user/repos?per_page=100&sort=full_name&affiliation=owner,collaborator,organization_member';
    const pages = await this.fetchAllPages<{
      full_name: string;
      private: boolean;
      default_branch: string;
    }>(url);

    const repos = pages.map((r) => ({
      fullName: r.full_name,
      private: r.private,
      defaultBranch: r.default_branch,
    }));

    useLogger().debug(`[github] fetched ${repos.length} repos`);
    this.setCache('repos', repos);
    return repos;
  }

  async getUser(): Promise<{ login: string }> {
    const cached = this.getCache<{ login: string }>('user');
    if (cached) return cached;
    const user = await this.apiFetch<{ login: string }>('https://api.github.com/user');
    this.setCache('user', user);
    return user;
  }

  async listOrgs(): Promise<string[]> {
    const cached = this.getCache<string[]>('orgs');
    if (cached) return cached;
    const orgs = await this.fetchAllPages<{ login: string }>('https://api.github.com/user/orgs?per_page=100');
    const result = orgs.map((o) => o.login);
    this.setCache('orgs', result);
    return result;
  }

  async createRepo(owner: string, name: string, isPrivate: boolean): Promise<GitHubRepo> {
    const user = await this.getUser();
    const isOrg = owner !== user.login;

    const url = isOrg
      ? `https://api.github.com/orgs/${owner}/repos`
      : 'https://api.github.com/user/repos';

    useLogger().info(`[github] creating repo ${owner}/${name} (private=${isPrivate}, org=${isOrg})`);

    const res = await fetch(url, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, private: isPrivate }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }));
      const message = (body as { message?: string }).message || res.statusText;
      useLogger().error(`[github] failed to create repo ${owner}/${name}: ${res.status} ${message}`);
      throw createError({
        statusCode: res.status,
        statusMessage: message,
      });
    }

    const data = (await res.json()) as { full_name: string; private: boolean; default_branch: string };

    // Invalidate repos cache so next list includes the new repo
    this.cache.delete('repos');

    useLogger().info(`[github] created repo ${data.full_name}`);

    return {
      fullName: data.full_name,
      private: data.private,
      defaultBranch: data.default_branch,
    };
  }

  async listBranches(owner: string, repo: string): Promise<{ branches: GitHubBranch[]; defaultBranch: string }> {
    const cacheKey = `branches:${owner}/${repo}`;
    const cached = this.getCache<{ branches: GitHubBranch[]; defaultBranch: string }>(cacheKey);
    if (cached) return cached;

    // Fetch repo info for default branch
    const repoInfo = await this.apiFetch<{ default_branch: string }>(
      `https://api.github.com/repos/${owner}/${repo}`,
    );
    const defaultBranch = repoInfo.default_branch;

    // Fetch all branches
    const pages = await this.fetchAllPages<{ name: string }>(
      `https://api.github.com/repos/${owner}/${repo}/branches?per_page=100`,
    );

    const result = {
      branches: pages.map((b) => ({ name: b.name })),
      defaultBranch,
    };

    useLogger().debug(`[github] fetched ${result.branches.length} branches for ${owner}/${repo} (default: ${defaultBranch})`);
    this.setCache(cacheKey, result);
    return result;
  }

  private async apiFetch<T>(url: string): Promise<T> {
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) {
      useLogger().error(`[github] API request failed: ${res.status} ${res.statusText} (${url})`);
      throw createError({ statusCode: res.status, statusMessage: `GitHub API error: ${res.statusText}` });
    }
    return res.json() as Promise<T>;
  }

  private async fetchAllPages<T>(url: string): Promise<T[]> {
    const results: T[] = [];
    let nextUrl: string | null = url;

    while (nextUrl) {
      const res = await fetch(nextUrl, { headers: this.headers() });
      if (!res.ok) {
        useLogger().error(`[github] paginated request failed: ${res.status} ${res.statusText} (${nextUrl})`);
        throw createError({ statusCode: res.status, statusMessage: `GitHub API error: ${res.statusText}` });
      }
      const page = (await res.json()) as T[];
      results.push(...page);
      nextUrl = this.parseNextLink(res.headers.get('link'));
    }

    return results;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `token ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  private parseNextLink(linkHeader: string | null): string | null {
    if (!linkHeader) return null;
    const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    return match?.[1] ?? null;
  }

  private getCache<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (entry && Date.now() < entry.expiresAt) return entry.data as T;
    if (entry) this.cache.delete(key);
    return null;
  }

  private setCache<T>(key: string, data: T): void {
    this.cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL });
  }
}

const instances = new Map<string, GitHubService>();

/** Returns a GitHubService bound to the given token, reusing instances so
 * their per-token caches persist across requests. */
export function getGitHubServiceForToken(token: string): GitHubService {
  let inst = instances.get(token);
  if (!inst) {
    inst = new GitHubService(token);
    instances.set(token, inst);
  }
  return inst;
}
