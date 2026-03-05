defineRouteMeta({
  openAPI: {
    tags: ['AGENTS.md'],
    summary: 'Update AGENTS.md entry',
    description: 'Updates an existing custom AGENTS.md entry. Built-in entries cannot be modified.',
    operationId: 'updateAgentsMdEntry',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'AGENTS.md entry ID' }],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/AgentsMdEntry' } } },
    },
    responses: {
      200: { description: 'Updated AGENTS.md entry', content: { 'application/json': { schema: { $ref: '#/components/schemas/AgentsMdEntry' } } } },
      400: { description: 'Cannot modify built-in entry', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'AGENTS.md entry not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useAgentsMdStore } from '../../utils/services';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  const body = await readBody(event);

  if (body.name !== undefined && (!body.name || typeof body.name !== 'string')) {
    throw createError({ statusCode: 400, statusMessage: 'name must be a non-empty string' });
  }

  const store = useAgentsMdStore();

  try {
    return await store.update(id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.content !== undefined ? { content: body.content } : {}),
    });
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message.includes('not found')) {
        throw createError({ statusCode: 404, statusMessage: 'AGENTS.md entry not found' });
      }
      if (err.message.includes('built-in')) {
        throw createError({ statusCode: 400, statusMessage: err.message });
      }
    }
    throw err;
  }
});
