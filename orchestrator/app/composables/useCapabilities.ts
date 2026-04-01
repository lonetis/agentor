import type { CapabilityInfo } from '~/types';

export function useCapabilities() {
  const { data: capabilities, refresh } = useFetch<CapabilityInfo[]>('/api/capabilities', {
    default: () => [],
  });

  async function createCapability(data: { name: string; content: string }): Promise<CapabilityInfo> {
    const result = await $fetch<CapabilityInfo>('/api/capabilities', {
      method: 'POST',
      body: data,
    });
    await refresh();
    return result;
  }

  async function updateCapability(id: string, data: { name?: string; content?: string }): Promise<CapabilityInfo> {
    const result = await $fetch<CapabilityInfo>(`/api/capabilities/${id}`, {
      method: 'PUT',
      body: data,
    });
    await refresh();
    return result;
  }

  async function deleteCapability(id: string): Promise<void> {
    await $fetch(`/api/capabilities/${id}`, { method: 'DELETE' });
    await refresh();
  }

  return {
    capabilities,
    refresh,
    createCapability,
    updateCapability,
    deleteCapability,
  };
}
