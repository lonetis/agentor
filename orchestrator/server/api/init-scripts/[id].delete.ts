defineRouteMeta({
  openAPI: {
    tags: ['Init Scripts'],
    summary: 'Delete init script',
    description: 'Deletes a custom init script. Built-in scripts cannot be deleted.',
    operationId: 'deleteInitScript',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Init script ID' }],
    responses: {
      200: { description: 'Init script deleted', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
      400: { description: 'Cannot delete built-in script', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'Init script not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useInitScriptStore } from '../../utils/services';
import { requireAuth, canAccessResource } from '../../utils/auth-helpers';

export default defineEventHandler(async (event) => {
  const ctx = requireAuth(event);
  const id = getRouterParam(event, 'id')!;
  const store = useInitScriptStore();

  const existing = store.getById(id);
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Init script not found' });
  }
  if (!canAccessResource(ctx, existing, { allowGlobal: false })) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }

  try {
    await store.delete(id);
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message.includes('not found')) {
        throw createError({ statusCode: 404, statusMessage: 'Init script not found' });
      }
      if (err.message.includes('built-in')) {
        throw createError({ statusCode: 400, statusMessage: err.message });
      }
    }
    throw err;
  }

  return { ok: true };
});
