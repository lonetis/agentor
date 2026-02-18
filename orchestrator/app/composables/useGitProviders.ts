import type { GitProviderInfo } from '~/types';

export function useGitProviders() {
  const { data: gitProviders } = useFetch<GitProviderInfo[]>('/api/git-providers', {
    default: () => [],
  });

  return { gitProviders };
}
