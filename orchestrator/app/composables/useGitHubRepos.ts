import type { GitHubRepoInfo } from '~/types';

export function useGitHubRepos() {
  const repos = ref<GitHubRepoInfo[]>([]);
  const reposLoading = ref(false);
  const username = ref('');
  const orgs = ref<string[]>([]);
  const error = ref('');
  let fetchPromise: Promise<void> | null = null;

  async function fetchRepos(force = false) {
    if (fetchPromise && !force) return fetchPromise;
    fetchPromise = (async () => {
      reposLoading.value = true;
      error.value = '';
      try {
        const data = await $fetch<{
          repos: GitHubRepoInfo[];
          tokenConfigured: boolean;
          username: string;
          orgs: string[];
          error?: string;
        }>('/api/github/repos');
        repos.value = data.repos;
        username.value = data.username;
        orgs.value = data.orgs;
        // A token is set but the GitHub request failed (bad token / scopes /
        // rate limit) — surface it instead of showing an empty dropdown.
        error.value = data.error || '';
      } catch (err) {
        repos.value = [];
        error.value = err instanceof Error ? err.message : 'Failed to load repositories';
      } finally {
        fetchPromise = null;
        reposLoading.value = false;
      }
    })();
    return fetchPromise;
  }

  function addRepoToList(repo: GitHubRepoInfo) {
    repos.value = [...repos.value, repo].sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  return { repos, reposLoading, username, orgs, error, fetchRepos, addRepoToList };
}
