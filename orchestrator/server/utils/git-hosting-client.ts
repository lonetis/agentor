import type { GitBranchList, GitRepoInfo } from '../../shared/types';
import type { GitProvider } from './git-providers';
import { useLogger } from './services';

/** What the dashboard needs from a git hosting API, independent of the
 * provider. Implementations are bound to one provider + one user token. */
export interface GitHostingService {
  /** The token's account — the default owner for new repositories. */
  getUsername(): Promise<string>;
  listRepos(): Promise<GitRepoInfo[]>;
  /** Other namespaces (GitHub orgs, GitLab groups) the user can create repositories in. */
  listNamespaces(): Promise<string[]>;
  listBranches(fullName: string): Promise<GitBranchList>;
  /** `namespace` is the user's own login or one of `listNamespaces()`. */
  createRepo(namespace: string, name: string, isPrivate: boolean): Promise<GitRepoInfo>;
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const CACHE_TTL = 60_000;
/** Timeout for every outbound API call so a hung socket can't pin a request
 * handler forever. */
const FETCH_TIMEOUT_MS = 30_000;

/** HTTP plumbing shared by the provider clients: auth headers, timeouts, a
 * 60s per-instance response cache, pagination and error mapping. */
export abstract class GitHostingClient implements GitHostingService {
  private cache = new Map<string, CacheEntry<unknown>>();

  constructor(
    protected readonly provider: GitProvider,
    protected readonly token: string,
  ) {}

  abstract getUsername(): Promise<string>;
  abstract listRepos(): Promise<GitRepoInfo[]>;
  abstract listNamespaces(): Promise<string[]>;
  abstract listBranches(fullName: string): Promise<GitBranchList>;
  abstract createRepo(namespace: string, name: string, isPrivate: boolean): Promise<GitRepoInfo>;

  protected abstract headers(): Record<string, string>;
  /** URL of the page after `res`, or null on the last page. */
  protected abstract nextPageUrl(res: Response, url: string): string | null;

  protected get logTag(): string {
    return `[git:${this.provider.id}]`;
  }

  protected async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const entry = this.cache.get(key);
    if (entry && Date.now() < entry.expiresAt) return entry.data as T;
    const data = await load();
    this.cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL });
    return data;
  }

  protected invalidate(key: string): void {
    this.cache.delete(key);
  }

  protected async request<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const res = await this.send(url, init);
    return res.json() as Promise<T>;
  }

  protected async fetchAllPages<T>(url: string): Promise<T[]> {
    const results: T[] = [];
    let nextUrl: string | null = url;
    while (nextUrl) {
      const res = await this.send(nextUrl);
      results.push(...((await res.json()) as T[]));
      nextUrl = this.nextPageUrl(res, nextUrl);
    }
    return results;
  }

  private async send(url: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
    const method = init.method ?? 'GET';
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          ...this.headers(),
          ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      useLogger().error(`${this.logTag} ${method} ${url} failed: ${reason}`);
      throw createError({ statusCode: 502, statusMessage: `${this.provider.displayName} is unreachable: ${reason}` });
    }
    if (!res.ok) {
      const body = await res.json().catch(() => undefined);
      const detail = describeErrorBody(body) || res.statusText;
      useLogger().error(`${this.logTag} ${method} ${url} failed: ${res.status} ${detail}`);
      throw createError({
        statusCode: mapUpstreamStatus(res.status),
        statusMessage: `${this.provider.displayName} API error (${res.status}): ${detail}`,
      });
    }
    return res;
  }
}

/** Upstream 401 means the provider rejected the user's token — reported as 502
 * so it is never mistaken for the caller's own dashboard session expiring.
 * Validation failures (400/422) become 400; 5xx become 502. */
function mapUpstreamStatus(status: number): number {
  if (status === 401 || status >= 500) return 502;
  if (status === 422) return 400;
  return status;
}

/** Error bodies: GitHub `{ message }`, GitLab `{ message }` / `{ error }`, where
 * a GitLab validation `message` is an object of field → messages. */
function describeErrorBody(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const { message, error } = body as { message?: unknown; error?: unknown };
  if (typeof message === 'string') return message;
  if (message && typeof message === 'object') {
    return Object.entries(message as Record<string, unknown>)
      .map(([field, msgs]) => `${field} ${Array.isArray(msgs) ? msgs.join(', ') : String(msgs)}`)
      .join('; ');
  }
  return typeof error === 'string' ? error : '';
}
