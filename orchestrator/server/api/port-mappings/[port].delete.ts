defineRouteMeta({
  openAPI: {
    tags: ['Port Mappings'],
    summary: 'Delete port mapping',
    description: 'Removes a port mapping by its external port number.',
    operationId: 'deletePortMapping',
    parameters: [{ name: 'port', in: 'path', required: true, schema: { type: 'integer' }, description: 'External port number' }],
    responses: {
      200: { description: 'Port mapping deleted', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
      404: { description: 'Port mapping not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { usePortMappingStore, useTraefikManager } from '../../utils/services';
import { requireAuth } from '../../utils/auth-helpers';

export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event);
  const port = parseInt(getRouterParam(event, 'port')!, 10);

  if (isNaN(port)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid port number',
    });
  }

  const store = usePortMappingStore();
  const existing = store.findByPort(port);
  if (!existing) {
    return { ok: true };
  }
  if (user.role !== 'admin' && existing.userId !== user.id) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }

  const removed = await store.remove(port);
  if (removed) {
    await useTraefikManager().reconcile();
  }
  return { ok: true };
});
