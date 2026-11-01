import type { AgentUsageStatus } from '~/types';
import { createSharedPoller } from '~/composables/usePolling';
import { assignIfChanged } from '~/utils/assign-if-changed';

const status = ref<AgentUsageStatus | null>(null);
/** Why the last load failed; null after a successful load. */
const error = ref<string | null>(null);
const refreshing = ref(false);

function apply(next: AgentUsageStatus) {
  assignIfChanged(status, next);
  error.value = null;
}

async function fetchStatus() {
  try {
    apply(await $fetch<AgentUsageStatus>('/api/usage'));
  } catch (err) {
    // Keep the last status so a failed poll does not blank the panel.
    error.value = fetchErrorMessage(err, 'Failed to load usage');
    console.warn('[usage] Failed to load usage:', err);
  }
}

// Match the server-side UsageChecker cadence (5 min) so the sidebar never
// lags the polled usage state by more than one server cycle.
const poller = createSharedPoller(fetchStatus, 300_000);

async function refresh() {
  refreshing.value = true;
  try {
    apply(await $fetch<AgentUsageStatus>('/api/usage/refresh', { method: 'POST' }));
  } catch (err) {
    console.warn('[usage] Usage refresh failed, reloading the last polled state:', err);
    await fetchStatus();
  } finally {
    refreshing.value = false;
  }
}

export function useUsage() {
  poller.use();

  return { status, error, refreshing, refresh, retry: poller.trigger };
}
