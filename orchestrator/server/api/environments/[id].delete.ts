defineRouteMeta({
  openAPI: {
    tags: ['Environments'],
    summary: 'Delete environment',
    description: 'Deletes an environment configuration.',
    operationId: 'deleteEnvironment',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Environment ID' }],
    responses: {
      200: { description: 'Environment deleted', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
      404: { description: 'Environment not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useEnvironmentStore } from '../../utils/services';
import { requireAuth, canAccessResource } from '../../utils/auth-helpers';

export default defineEventHandler(async (event) => {
  const ctx = requireAuth(event);
  const id = getRouterParam(event, 'id')!;
  const store = useEnvironmentStore();

  const existing = store.getById(id);
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Environment not found' });
  }
  if (existing.builtIn) {
    throw createError({ statusCode: 400, statusMessage: 'Cannot delete built-in environments' });
  }
  if (!canAccessResource(ctx, existing, { allowGlobal: false })) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }

  try {
    await store.delete(id);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('not found')) {
      throw createError({ statusCode: 404, statusMessage: 'Environment not found' });
    }
    throw err;
  }

  return { ok: true };
});
