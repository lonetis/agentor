defineRouteMeta({
  openAPI: {
    tags: ['Instructions'],
    summary: 'Create instruction',
    description: 'Creates a new custom instruction.',
    operationId: 'createInstruction',
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Instruction' } } },
    },
    responses: {
      201: { description: 'Created instruction', content: { 'application/json': { schema: { $ref: '#/components/schemas/Instruction' } } } },
      400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useInstructionStore } from '../../utils/services';
import { requireAuth } from '../../utils/auth-helpers';

export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event);
  const body = await readBody(event);

  if (!body.name || typeof body.name !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'name is required' });
  }
  if (!body.content || typeof body.content !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'content is required' });
  }

  const store = useInstructionStore();
  const entry = await store.create({ name: body.name, content: body.content, userId: user.id });

  setResponseStatus(event, 201);
  return entry;
});
