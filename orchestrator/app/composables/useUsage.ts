import type { AgentUsageStatus } from '~/types';

const status = ref<AgentUsageStatus | null>(null);
const refreshing = ref(false);
let initialized = false;

async function fetchStatus() {
  try {
    status.value = await $fetch<AgentUsageStatus>('/api/usage');
  } catch {
    status.value = null;
  }
}

async function refresh() {
  refreshing.value = true;
  try {
    status.value = await $fetch<AgentUsageStatus>('/api/usage/refresh', { method: 'POST' });
  } catch {
    await fetchStatus();
  } finally {
    refreshing.value = false;
  }
}

export function useUsage() {
  if (!initialized) {
    initialized = true;
    fetchStatus();
  }
  // Match the server-side UsageChecker cadence (5 min) so the sidebar never
  // lags the polled usage state by more than one server cycle.
  usePolling(() => fetchStatus(), 300_000);

  return { status, refreshing, refresh };
}
