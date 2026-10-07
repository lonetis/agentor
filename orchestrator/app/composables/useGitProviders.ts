import type { GitProviderInfo } from '~/types';

// Module-level singleton so every caller (sidebar, create-worker modal, worker
// settings modal, account modal) shares one provider list — and a single
// `refresh()` updates them all. This is what lets the repo autocomplete light
// up immediately after the user saves a token in the Account modal, without a
// page reload.
const gitProviders = ref<GitProviderInfo[]>([]);
let pending: Promise<void> | null = null;

function fetchProviders(): Promise<void> {
  pending = (async () => {
    try {
      gitProviders.value = await $fetch<GitProviderInfo[]>('/api/git-providers');
    } catch {
      gitProviders.value = [];
    }
  })();
  return pending;
}

export function useGitProviders() {
  if (!pending) fetchProviders();
  return {
    gitProviders,
    refresh: fetchProviders,
    /** Resolves once the current (initial or refresh) fetch has finished. */
    ready: () => pending!,
  };
}
