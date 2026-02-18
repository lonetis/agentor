import { useDomainMappingStore, useTraefikManager } from '../../utils/services';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;

  const store = useDomainMappingStore();
  const removed = await store.remove(id);
  if (removed) {
    await useTraefikManager().reconcile();
  }
  return { ok: true };
});
