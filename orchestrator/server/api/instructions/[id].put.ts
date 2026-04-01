defineRouteMeta({
  openAPI: {
    tags: ['Instructions'],
    summary: 'Update instruction',
    description: 'Updates an existing custom instruction. Built-in instructions cannot be modified.',
    operationId: 'updateInstruction',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Instruction ID' }],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Instruction' } } },
    },
    responses: {
      200: { description: 'Updated instruction', content: { 'application/json': { schema: { $ref: '#/components/schemas/Instruction' } } } },
      400: { description: 'Cannot modify built-in entry', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'Instruction not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useInstructionStore } from '../../utils/services';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  const body = await readBody(event);

  if (body.name !== undefined && (!body.name || typeof body.name !== 'string')) {
    throw createError({ statusCode: 400, statusMessage: 'name must be a non-empty string' });
  }

  const store = useInstructionStore();

  try {
    return await store.update(id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.content !== undefined ? { content: body.content } : {}),
    });
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
});
