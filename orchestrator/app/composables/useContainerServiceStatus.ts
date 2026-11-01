import type { ServiceStatus } from '~/types';

// A phone waking up or a flaky network often fails a poll or two. Treating one
// failure as "stopped" would destroy the Desktop / Editor iframe and force a
// full noVNC / code-server reload, so only a streak of failures does.
const FAILURES_BEFORE_DOWN = 3;

export function useContainerServiceStatus(containerId: Ref<string | undefined>, endpoint: string) {
  const status = ref<ServiceStatus>({ running: false });
  let failures = 0;

  function apply(next: ServiceStatus) {
    if (next.running === status.value.running && next.containerId === status.value.containerId) return;
    status.value = next;
  }

  async function fetchStatus() {
    const id = containerId.value;
    if (!id) {
      failures = 0;
      apply({ running: false });
      return;
    }
    try {
      const next = await $fetch<ServiceStatus>(`/api/containers/${id}/${endpoint}/status`);
      if (id !== containerId.value) return;
      failures = 0;
      apply(next);
    } catch (err) {
      if (id !== containerId.value) return;
      failures++;
      if (failures === 1) console.warn(`[${endpoint}] Status check for ${id} failed:`, err);
      if (failures >= FAILURES_BEFORE_DOWN) apply({ running: false });
    }
  }

  const poller = usePolling(fetchStatus, 5_000);

  watch(containerId, () => {
    failures = 0;
    void poller.trigger();
  }, { immediate: true });

  return { status };
}
