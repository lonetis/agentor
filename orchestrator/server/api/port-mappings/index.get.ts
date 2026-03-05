defineRouteMeta({
  openAPI: {
    tags: ['Port Mappings'],
    summary: 'List port mappings',
    description: 'Returns all active TCP port mappings.',
    operationId: 'listPortMappings',
    responses: {
      200: {
        description: 'Array of port mappings',
        content: {
          'application/json': {
            schema: {
              type: 'array',
              items: { $ref: '#/components/schemas/PortMapping' },
            },
          },
        },
      },
    },
    $global: {
      components: {
        schemas: {
          PortMapping: {
            type: 'object',
            properties: {
              externalPort: { type: 'integer' },
              type: { type: 'string', enum: ['localhost', 'external'] },
              workerId: { type: 'string' },
              workerName: { type: 'string' },
              internalPort: { type: 'integer' },
              appType: { type: 'string' },
              instanceId: { type: 'string' },
            },
          },
        },
      },
    },
  },
});

import { usePortMappingStore } from '../../utils/services';

export default defineEventHandler(() => {
  return usePortMappingStore().list();
});
