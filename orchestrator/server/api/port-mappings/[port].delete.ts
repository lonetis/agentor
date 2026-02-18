import { usePortMappingStore, useMapperManager } from '../../utils/services';

export default defineEventHandler(async (event) => {
  const port = parseInt(getRouterParam(event, 'port')!, 10);

  if (isNaN(port)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid port number',
    });
  }

  const store = usePortMappingStore();
  const removed = await store.remove(port);
  if (removed) {
    await useMapperManager().reconcile();
  }
  return { ok: true };
});
