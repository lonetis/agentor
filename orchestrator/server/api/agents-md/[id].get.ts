defineRouteMeta({
  openAPI: {
    tags: ['AGENTS.md'],
    summary: 'Get AGENTS.md entry',
    description: 'Returns a single AGENTS.md entry by ID.',
    operationId: 'getAgentsMdEntry',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'AGENTS.md entry ID' }],
    responses: {
      200: { description: 'AGENTS.md entry details', content: { 'application/json': { schema: { $ref: '#/components/schemas/AgentsMdEntry' } } } },
      404: { description: 'AGENTS.md entry not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useAgentsMdStore } from '../../utils/services';

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')!;
  const entry = useAgentsMdStore().get(id);

  if (!entry) {
    throw createError({ statusCode: 404, statusMessage: 'AGENTS.md entry not found' });
  }

  return entry;
});
