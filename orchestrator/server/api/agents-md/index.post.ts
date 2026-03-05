defineRouteMeta({
  openAPI: {
    tags: ['AGENTS.md'],
    summary: 'Create AGENTS.md entry',
    description: 'Creates a new custom AGENTS.md entry.',
    operationId: 'createAgentsMdEntry',
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/AgentsMdEntry' } } },
    },
    responses: {
      201: { description: 'Created AGENTS.md entry', content: { 'application/json': { schema: { $ref: '#/components/schemas/AgentsMdEntry' } } } },
      400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useAgentsMdStore } from '../../utils/services';

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (!body.name || typeof body.name !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'name is required' });
  }
  if (!body.content || typeof body.content !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'content is required' });
  }

  const store = useAgentsMdStore();
  const entry = await store.create({ name: body.name, content: body.content });

  setResponseStatus(event, 201);
  return entry;
});
