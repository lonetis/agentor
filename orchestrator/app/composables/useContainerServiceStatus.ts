import type { ServiceStatus } from '~/types';

export function useContainerServiceStatus(containerId: Ref<string | undefined>, endpoint: string) {
  const status = ref<ServiceStatus>({ running: false });

  async function fetchStatus() {
    if (!containerId.value) {
      status.value = { running: false };
      return;
    }
    try {
      status.value = await $fetch<ServiceStatus>(
        `/api/containers/${containerId.value}/${endpoint}/status`
      );
    } catch {
      status.value = { running: false };
    }
  }

  watch(containerId, fetchStatus, { immediate: true });
  usePolling(fetchStatus, 5_000);

  return { status };
}
