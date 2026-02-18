import type { PortMapping } from '~/types';

export function usePortMappings() {
  const mappings = ref<PortMapping[]>([]);

  async function fetchMappings() {
    try {
      mappings.value = await $fetch<PortMapping[]>('/api/port-mappings');
    } catch {
      mappings.value = [];
    }
  }

  async function createMapping(opts: {
    externalPort: number;
    type: 'localhost' | 'external';
    workerId: string;
    internalPort: number;
    appType?: string;
    instanceId?: string;
  }) {
    const result = await $fetch<PortMapping>('/api/port-mappings', {
      method: 'POST',
      body: opts,
    });
    await fetchMappings();
    return result;
  }

  async function removeMapping(port: number) {
    await $fetch(`/api/port-mappings/${port}`, { method: 'DELETE' });
    await fetchMappings();
  }

  fetchMappings();
  usePolling(fetchMappings, 10_000);

  return {
    mappings,
    createMapping,
    removeMapping,
  };
}
