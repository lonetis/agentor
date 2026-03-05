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
