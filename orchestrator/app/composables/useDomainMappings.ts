import type { DomainMapping, DomainMapperStatus } from '~/types';

interface DomainMappingInput {
  subdomain: string;
  baseDomain: string;
  path?: string;
  protocol: 'http' | 'https' | 'tcp';
  wildcard?: boolean;
  workerId: string;
  internalPort: number;
  basicAuth?: { username: string; password: string };
}

// Module-level singleton — the sidebar and the Domain Mappings panel share one
// list/status and a single poller (matching useWorkerMetrics/useUsage), so
// opening the panel does not start a second 10s poll or a divergent copy.
const mappings = ref<DomainMapping[]>([]);
const status = ref<DomainMapperStatus>({ enabled: false, baseDomains: [], baseDomainConfigs: [], totalMappings: 0 });
let initialized = false;

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
    status.value = { enabled: false, baseDomains: [], baseDomainConfigs: [], totalMappings: 0 };
  }
}

async function createMapping(opts: DomainMappingInput) {
  const result = await $fetch<DomainMapping>('/api/domain-mappings', {
    method: 'POST',
    body: opts,
  });
  await fetchMappings();
  return result;
}

async function createMappings(items: DomainMappingInput[]) {
  const result = await $fetch<DomainMapping[]>('/api/domain-mappings/batch', {
    method: 'POST',
    body: { items },
  });
  await fetchMappings();
  return result;
}

async function removeMapping(id: string) {
  await $fetch(`/api/domain-mappings/${id}`, { method: 'DELETE' });
  await fetchMappings();
}

export function useDomainMappings() {
  if (!initialized) {
    initialized = true;
    fetchMappings();
    fetchStatus();
  }
  usePolling(fetchMappings, 10_000);

  return {
    mappings,
    status,
    createMapping,
    createMappings,
    removeMapping,
  };
}
