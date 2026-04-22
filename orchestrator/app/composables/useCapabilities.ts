import type { CapabilityInfo } from '~/types';

export function useCapabilities() {
  const { data: capabilities, refresh, create, update, remove } = useCrudResource<CapabilityInfo>('/api/capabilities');
  return {
    capabilities,
    refresh,
    createCapability: create,
    updateCapability: update,
    deleteCapability: remove,
  };
}
