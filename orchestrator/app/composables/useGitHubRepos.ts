import type { GitHubRepoInfo } from '~/types';

export function useGitHubRepos() {
  const repos = ref<GitHubRepoInfo[]>([]);
  const reposLoading = ref(false);
  const username = ref('');
  const orgs = ref<string[]>([]);
  let fetchPromise: Promise<void> | null = null;

  async function fetchRepos(force = false) {
    if (fetchPromise && !force) return fetchPromise;
    fetchPromise = (async () => {
      reposLoading.value = true;
      try {
        const data = await $fetch<{
          repos: GitHubRepoInfo[];
          tokenConfigured: boolean;
          username: string;
          orgs: string[];
        }>('/api/github/repos');
        repos.value = data.repos;
        username.value = data.username;
        orgs.value = data.orgs;
      } catch {
        repos.value = [];
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

  return { repos, reposLoading, username, orgs, fetchRepos, addRepoToList };
}
