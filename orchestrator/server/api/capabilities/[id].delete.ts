defineRouteMeta({
  openAPI: {
    tags: ['Capabilities'],
    summary: 'Delete capability',
    description: 'Deletes a custom capability. Built-in capabilities cannot be deleted.',
    operationId: 'deleteCapability',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Capability ID' }],
    responses: {
      200: { description: 'Capability deleted', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
      400: { description: 'Cannot delete built-in capability', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'Capability not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useCapabilityStore } from '../../utils/services';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  const store = useCapabilityStore();

  try {
    await store.delete(id);
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message.includes('not found')) {
        throw createError({ statusCode: 404, statusMessage: 'Capability not found' });
      }
      if (err.message.includes('built-in')) {
        throw createError({ statusCode: 400, statusMessage: err.message });
      }
    }
    throw err;
  }

  return { ok: true };
});
