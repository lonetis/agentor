import type { AgentUsageStatus } from '~/types';

export function useUsage() {
  const status = ref<AgentUsageStatus | null>(null);

  async function fetchStatus() {
    try {
      status.value = await $fetch<AgentUsageStatus>('/api/usage');
    } catch {
      status.value = null;
    }
  }

  fetchStatus();
  usePolling(() => fetchStatus(), 300_000);

  return { status };
}
