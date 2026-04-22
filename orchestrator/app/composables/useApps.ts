import type { AppTypeInfo, AppInstanceInfo } from '~/types';

export function useApps(containerId: Ref<string | undefined>) {
  const appTypes = ref<AppTypeInfo[]>([]);
  const instances = ref<AppInstanceInfo[]>([]);

  async function fetchAppTypes() {
    appTypes.value = await $fetch<AppTypeInfo[]>('/api/app-types');
  }

  async function fetchInstances() {
    if (!containerId.value) {
      instances.value = [];
      return;
    }
    try {
      instances.value = await $fetch<AppInstanceInfo[]>(
        `/api/containers/${containerId.value}/apps`
      );
    } catch {
      instances.value = [];
    }
  }

  async function createInstance(appType: string) {
    if (!containerId.value) return;
    const result = await $fetch<{ id: string; port: number; externalPort?: number }>(
      `/api/containers/${containerId.value}/apps/${appType}`,
      { method: 'POST' }
    );
    await fetchInstances();
    return result;
  }

  async function stopInstance(appType: string, instanceId: string) {
    if (!containerId.value) return;
    await $fetch(
      `/api/containers/${containerId.value}/apps/${appType}/${instanceId}`,
      { method: 'DELETE' }
    );
    await fetchInstances();
  }

  const { start, stop } = usePolling(() => {
    if (containerId.value) fetchInstances();
  }, 5_000);

  watch(containerId, () => {
    stop();
    fetchInstances();
    start();
  }, { immediate: true });

  fetchAppTypes();

  return {
    appTypes,
    instances,
    createInstance,
    stopInstance,
  };
}
