defineRouteMeta({
  openAPI: {
    tags: ['Worker Self'],
    summary: 'Delete a domain mapping owned by the calling worker',
    description: 'Removes a domain mapping by id. Mapping must belong to the calling worker.',
    operationId: 'workerSelfDeleteDomainMapping',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: {
      200: { description: 'Domain mapping deleted (idempotent)' },
      401: { description: 'Caller IP did not resolve to a managed worker' },
      403: { description: 'Mapping is owned by a different worker' },
    },
  },
});

import { useDomainMappingStore, useTraefikManager } from '../../../utils/services';
import { requireWorkerSelf } from '../../../utils/worker-auth';

export default defineEventHandler(async (event) => {
  const ctx = await requireWorkerSelf(event);
  const id = getRouterParam(event, 'id')!;

  const store = useDomainMappingStore();
  const existing = store.findById(id);
  if (!existing) {
    return { ok: true };
  }
  if (existing.item.containerName !== ctx.containerName) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: mapping is owned by a different worker' });
  }

  const removed = await store.remove(id);
  if (removed) {
    await useTraefikManager().reconcile();
  }
  return { ok: true };
});
