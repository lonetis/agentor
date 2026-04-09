defineRouteMeta({
  openAPI: {
    tags: ['Domain Mappings'],
    summary: 'Delete domain mapping',
    description: 'Removes a domain mapping by its ID.',
    operationId: 'deleteDomainMapping',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Domain mapping ID' }],
    responses: {
      200: { description: 'Domain mapping deleted', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
      404: { description: 'Mapping not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useDomainMappingStore, useTraefikManager } from '../../utils/services';
import { requireAuth } from '../../utils/auth-helpers';

export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event);
  const id = getRouterParam(event, 'id')!;

  const store = useDomainMappingStore();
  const existing = store.get(id);
  if (!existing) {
    return { ok: true };
  }
  if (user.role !== 'admin' && existing.userId !== user.id) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }

  const removed = await store.remove(id);
  if (removed) {
    await useTraefikManager().reconcile();
  }
  return { ok: true };
});
