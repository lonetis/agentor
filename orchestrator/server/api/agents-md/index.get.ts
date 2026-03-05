defineRouteMeta({
  openAPI: {
    tags: ['AGENTS.md'],
    summary: 'List AGENTS.md entries',
    description: 'Returns all AGENTS.md entries (built-in and custom).',
    operationId: 'listAgentsMdEntries',
    responses: {
      200: {
        description: 'Array of AGENTS.md entries',
        content: {
          'application/json': {
            schema: {
              type: 'array',
              items: { $ref: '#/components/schemas/AgentsMdEntry' },
            },
          },
        },
      },
    },
    $global: {
      components: {
        schemas: {
          AgentsMdEntry: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              content: { type: 'string' },
              builtIn: { type: 'boolean' },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
  },
});

import { useAgentsMdStore } from '../../utils/services';

export default defineEventHandler(() => {
  return useAgentsMdStore().list();
});
