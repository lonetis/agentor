import type { AppTypeInfo, AppInstanceInfo } from '~/types';
import { assignIfChanged } from '~/utils/assign-if-changed';

let appTypesRequest: Promise<AppTypeInfo[]> | null = null;

// The app registry is static for a running orchestrator, so one request serves
// every Apps tab.
function loadAppTypes(): Promise<AppTypeInfo[]> {
  appTypesRequest ??= $fetch<AppTypeInfo[]>('/api/app-types').catch((err: unknown) => {
    appTypesRequest = null; // let the next Apps tab retry
    throw err;
  });
  return appTypesRequest;
}

export function useApps(containerId: Ref<string | undefined>) {
  const appTypes = ref<AppTypeInfo[]>([]);
  const instances = ref<AppInstanceInfo[]>([]);

  async function fetchInstances() {
    const id = containerId.value;
    if (!id) {
      instances.value = [];
      return;
    }
    try {
      const list = await $fetch<AppInstanceInfo[]>(`/api/containers/${id}/apps`);
      if (id === containerId.value) assignIfChanged(instances, list);
    } catch (err) {
      if (id !== containerId.value) return;
      console.warn(`[apps] Failed to list the app instances of ${id}:`, err);
      instances.value = [];
    }
  }

  // Each poll runs several `docker exec`s, so it pauses while the Apps tab is hidden.
  const poller = usePolling(fetchInstances, 5_000);

  async function createInstance(appType: string) {
    if (!containerId.value) return;
    const result = await $fetch<{ id: string; port: number; externalPort?: number }>(
      `/api/containers/${containerId.value}/apps/${appType}`,
      { method: 'POST' }
    );
    await poller.trigger();
    return result;
  }

  async function stopInstance(appType: string, instanceId: string) {
    if (!containerId.value) return;
    await $fetch(
      `/api/containers/${containerId.value}/apps/${appType}/${instanceId}`,
      { method: 'DELETE' }
    );
    await poller.trigger();
  }

  watch(containerId, () => { void poller.trigger(); }, { immediate: true });

  loadAppTypes()
    .then((types) => { appTypes.value = types; })
    .catch((err: unknown) => { console.warn('[apps] Failed to load app types:', err); });

  return {
    appTypes,
    instances,
    createInstance,
    stopInstance,
  };
}
