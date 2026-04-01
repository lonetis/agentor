defineRouteMeta({
  openAPI: {
    tags: ['Capabilities'],
    summary: 'List capabilities',
    description: 'Returns all capabilities (built-in and custom).',
    operationId: 'listCapabilities',
    responses: {
      200: {
        description: 'Array of capabilities',
        content: {
          'application/json': {
            schema: {
              type: 'array',
              items: { $ref: '#/components/schemas/Capability' },
            },
          },
        },
      },
    },
    $global: {
      components: {
        schemas: {
          Capability: {
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

import { useCapabilityStore } from '../../utils/services';

export default defineEventHandler(() => {
  return useCapabilityStore().list();
});
