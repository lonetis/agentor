defineRouteMeta({
  openAPI: {
    tags: ['Instructions'],
    summary: 'Get instruction',
    description: 'Returns a single instruction by ID.',
    operationId: 'getInstruction',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Instruction ID' }],
    responses: {
      200: { description: 'Instruction details', content: { 'application/json': { schema: { $ref: '#/components/schemas/Instruction' } } } },
      404: { description: 'Instruction not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useInstructionStore } from '../../utils/services';
import { requireAuth, canAccessResource } from '../../utils/auth-helpers';

export default defineEventHandler((event) => {
  const ctx = requireAuth(event);
  const id = getRouterParam(event, 'id')!;
  const entry = useInstructionStore().get(id);

  if (!entry) {
    throw createError({ statusCode: 404, statusMessage: 'Instruction not found' });
  }
  if (!canAccessResource(ctx, entry)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }

  return entry;
});
