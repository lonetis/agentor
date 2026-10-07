import type { GitBranchList, GitRepoInfo, GitRepoList } from '~/types';

export interface ProviderRepos {
  repos: GitRepoInfo[];
  loading: boolean;
  /** The token's account — the default owner for new repositories. */
  username: string;
  namespaces: string[];
  error: string;
  loadedAt: number;
}

/** Reused for this long before a repo row refetches the provider's list. */
const STALE_MS = 60_000;

// Module-level so every repo row (create-worker and worker-settings modals)
// shares one repo list per provider instead of fetching its own.
const state = reactive(new Map<string, ProviderRepos>());
const inflight = new Map<string, Promise<void>>();

function providerPath(providerId: string): string {
  return `/api/git-providers/${encodeURIComponent(providerId)}`;
}

function entry(providerId: string): ProviderRepos {
  if (!state.has(providerId)) {
    state.set(providerId, { repos: [], loading: false, username: '', namespaces: [], error: '', loadedAt: 0 });
  }
  return state.get(providerId)!;
}

/** Fetch a provider's repos unless a fresh list is cached (or `force`). */
function load(providerId: string, force = false): Promise<void> {
  const e = entry(providerId);
  if (!force && Date.now() - e.loadedAt < STALE_MS) return Promise.resolve();
  const pending = inflight.get(providerId);
  if (pending) return pending;

  const request = (async () => {
    e.loading = true;
    try {
      const data = await $fetch<GitRepoList>(`${providerPath(providerId)}/repos`);
      e.repos = data.repos;
      e.username = data.username;
      e.namespaces = data.namespaces;
      // A token is set but the provider request failed (bad token / scopes /
      // unreachable) — surface it instead of showing an empty dropdown.
      e.error = data.error || '';
      // Failures are not cached so the next row retries.
      e.loadedAt = data.error ? 0 : Date.now();
    } catch (err) {
      e.repos = [];
      e.error = fetchErrorMessage(err, 'Failed to load repositories');
      e.loadedAt = 0;
    } finally {
      e.loading = false;
      inflight.delete(providerId);
    }
  })();
  inflight.set(providerId, request);
  return request;
}

function fetchBranches(providerId: string, fullName: string): Promise<GitBranchList> {
  return $fetch<GitBranchList>(`${providerPath(providerId)}/branches`, { query: { repo: fullName } });
}

async function createRepo(
  providerId: string,
  payload: { owner: string; name: string; isPrivate: boolean },
): Promise<GitRepoInfo> {
  const { repo } = await $fetch<{ repo: GitRepoInfo }>(`${providerPath(providerId)}/repos`, {
    method: 'POST',
    body: { owner: payload.owner, name: payload.name, private: payload.isPrivate },
  });
  const e = entry(providerId);
  e.repos = [...e.repos, repo].sort((a, b) => a.fullName.localeCompare(b.fullName));
  return repo;
}

/** Mark every cached list stale — e.g. after the user changed their tokens. */
function invalidate() {
  for (const e of state.values()) e.loadedAt = 0;
}

export function useGitRepos() {
  return {
    /** The cached state for a provider (undefined until first loaded). */
    reposFor: (providerId: string): ProviderRepos | undefined => state.get(providerId),
    load,
    fetchBranches,
    createRepo,
    invalidate,
  };
}
