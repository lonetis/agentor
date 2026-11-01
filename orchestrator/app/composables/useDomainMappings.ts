import type { DomainMapping, DomainMapperStatus } from '~/types';
import { createSharedPoller } from '~/composables/usePolling';
import { assignIfChanged } from '~/utils/assign-if-changed';

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

// Module-level singleton: the sidebar and the Domain Mappings panel share one
// list, one mapper status and a single poll.
const mappings = ref<DomainMapping[]>([]);
const status = ref<DomainMapperStatus>({ enabled: false, baseDomains: [], baseDomainConfigs: [], totalMappings: 0 });
let statusRequested = false;

async function fetchMappings() {
  try {
    assignIfChanged(mappings, await $fetch<DomainMapping[]>('/api/domain-mappings'));
  } catch (err) {
    // Keep the last list: a transient failure should not empty the panel.
    console.warn('[domain-mappings] Failed to load domain mappings:', err);
  }
}

// The mapper status reflects orchestrator configuration, so it is fetched once
// (again on the next use if that failed) instead of polled.
async function fetchStatus() {
  try {
    assignIfChanged(status, await $fetch<DomainMapperStatus>('/api/domain-mapper/status'));
  } catch (err) {
    statusRequested = false;
    console.warn('[domain-mappings] Failed to load the domain mapper status:', err);
  }
}

const poller = createSharedPoller(fetchMappings, 10_000);

async function createMapping(opts: DomainMappingInput) {
  const result = await $fetch<DomainMapping>('/api/domain-mappings', {
    method: 'POST',
    body: opts,
  });
  await poller.trigger();
  return result;
}

async function createMappings(items: DomainMappingInput[]) {
  const result = await $fetch<DomainMapping[]>('/api/domain-mappings/batch', {
    method: 'POST',
    body: { items },
  });
  await poller.trigger();
  return result;
}

async function removeMapping(id: string) {
  await $fetch(`/api/domain-mappings/${id}`, { method: 'DELETE' });
  await poller.trigger();
}

export function useDomainMappings() {
  if (!statusRequested) {
    statusRequested = true;
    void fetchStatus();
  }
  poller.use();

  return {
    mappings,
    status,
    createMapping,
    createMappings,
    removeMapping,
  };
}
