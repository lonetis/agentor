defineRouteMeta({
  openAPI: {
    tags: ['Worker Self'],
    summary: 'Delete a port mapping owned by the calling worker',
    description: 'Removes a port mapping by its external port. Mapping must belong to the calling worker.',
    operationId: 'workerSelfDeletePortMapping',
    parameters: [{ name: 'port', in: 'path', required: true, schema: { type: 'integer' }, description: 'External port number' }],
    responses: {
      200: { description: 'Port mapping deleted (idempotent)' },
      400: { description: 'Invalid port number' },
      401: { description: 'Caller IP did not resolve to a managed worker' },
      403: { description: 'Mapping is owned by a different worker' },
    },
  },
});

import { usePortMappingStore, useTraefikManager } from '../../../utils/services';
import { requireWorkerSelf } from '../../../utils/worker-auth';

export default defineEventHandler(async (event) => {
  const ctx = await requireWorkerSelf(event);
  const port = parseInt(getRouterParam(event, 'port')!, 10);

  if (isNaN(port)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid port number' });
  }

  const store = usePortMappingStore();
  const existing = store.findByPort(port);
  if (!existing) {
    return { ok: true };
  }
  if (existing.item.containerName !== ctx.containerName) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: mapping is owned by a different worker' });
  }

  const removed = await store.remove(port);
  if (removed) {
    await useTraefikManager().reconcile();
  }
  return { ok: true };
});
