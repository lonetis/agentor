import type { GitProviderInfo } from '~/types';

// Module-level singleton so every caller (sidebar, create-worker modal, worker
// settings modal) shares one provider list — and a single `refresh()` updates
// them all. This is what lets the repo autocomplete light up immediately after
// the user saves a GitHub token in the Account modal, without a page reload.
const gitProviders = ref<GitProviderInfo[]>([]);
let initialized = false;

async function fetchProviders() {
  try {
    gitProviders.value = await $fetch<GitProviderInfo[]>('/api/git-providers');
  } catch {
    gitProviders.value = [];
  }
}

export function useGitProviders() {
  if (!initialized) {
    initialized = true;
    fetchProviders();
  }
  return { gitProviders, refresh: fetchProviders };
}
