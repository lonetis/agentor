defineRouteMeta({
  openAPI: {
    tags: ['Instructions'],
    summary: 'Delete instruction',
    description: 'Deletes a custom instruction. Built-in instructions cannot be deleted.',
    operationId: 'deleteInstruction',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Instruction ID' }],
    responses: {
      200: { description: 'Instruction deleted', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
      400: { description: 'Cannot delete built-in entry', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'Instruction not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useInstructionStore } from '../../utils/services';
import { requireAuth, canAccessResource } from '../../utils/auth-helpers';

export default defineEventHandler(async (event) => {
  const ctx = requireAuth(event);
  const id = getRouterParam(event, 'id')!;
  const store = useInstructionStore();

  const existing = store.getById(id);
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Instruction not found' });
  }
  if (!canAccessResource(ctx, existing, { allowGlobal: false })) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }

  try {
    await store.delete(id);
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message.includes('not found')) {
        throw createError({ statusCode: 404, statusMessage: 'Instruction not found' });
      }
      if (err.message.includes('built-in')) {
        throw createError({ statusCode: 400, statusMessage: err.message });
      }
    }
    throw err;
  }

  return { ok: true };
});
