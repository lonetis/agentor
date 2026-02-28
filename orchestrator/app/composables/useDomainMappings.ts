import type { DomainMapping, DomainMapperStatus } from '~/types';

export function useDomainMappings() {
  const mappings = ref<DomainMapping[]>([]);
  const status = ref<DomainMapperStatus>({ enabled: false, baseDomains: [], totalMappings: 0 });

  async function fetchMappings() {
    try {
      mappings.value = await $fetch<DomainMapping[]>('/api/domain-mappings');
    } catch {
      mappings.value = [];
    }
  }

  async function fetchStatus() {
    try {
      status.value = await $fetch<DomainMapperStatus>('/api/domain-mapper/status');
    } catch {
      status.value = { enabled: false, baseDomains: [], totalMappings: 0 };
    }
  }

  async function createMapping(opts: {
    subdomain: string;
    baseDomain: string;
    protocol: 'http' | 'https' | 'tcp';
    workerId: string;
    internalPort: number;
    basicAuth?: { username: string; password: string };
  }) {
    const result = await $fetch<DomainMapping>('/api/domain-mappings', {
      method: 'POST',
      body: opts,
    });
    await fetchMappings();
    return result;
  }

  async function removeMapping(id: string) {
    await $fetch(`/api/domain-mappings/${id}`, { method: 'DELETE' });
    await fetchMappings();
  }

  fetchMappings();
  fetchStatus();
  usePolling(fetchMappings, 10_000);

  return {
    mappings,
    status,
    createMapping,
    removeMapping,
  };
}
