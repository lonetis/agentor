import type { PortMapping } from '~/types';
import { createSharedPoller } from '~/composables/usePolling';
import { assignIfChanged } from '~/utils/assign-if-changed';

// Module-level singleton: the sidebar and the Port Mappings panel share one
// list and a single poll.
const mappings = ref<PortMapping[]>([]);

async function fetchMappings() {
  try {
    assignIfChanged(mappings, await $fetch<PortMapping[]>('/api/port-mappings'));
  } catch (err) {
    // Keep the last list: a transient failure should not empty the panel.
    console.warn('[port-mappings] Failed to load port mappings:', err);
  }
}

const poller = createSharedPoller(fetchMappings, 10_000);

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
  await poller.trigger();
  return result;
}

async function removeMapping(port: number) {
  await $fetch(`/api/port-mappings/${port}`, { method: 'DELETE' });
  await poller.trigger();
}

export function usePortMappings() {
  poller.use();

  return {
    mappings,
    createMapping,
    removeMapping,
  };
}
