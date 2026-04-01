defineRouteMeta({
  openAPI: {
    tags: ['Domain Mappings'],
    summary: 'List domain mappings',
    description: 'Returns all Traefik domain mappings.',
    operationId: 'listDomainMappings',
    responses: {
      200: {
        description: 'Array of domain mappings',
        content: {
          'application/json': {
            schema: {
              type: 'array',
              items: { $ref: '#/components/schemas/DomainMapping' },
            },
          },
        },
      },
    },
    $global: {
      components: {
        schemas: {
          DomainMapping: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              subdomain: { type: 'string' },
              baseDomain: { type: 'string' },
              path: { type: 'string', description: 'URL path prefix (empty string = all paths)' },
              protocol: { type: 'string', enum: ['http', 'https', 'tcp'] },
              workerId: { type: 'string' },
              workerName: { type: 'string' },
              internalPort: { type: 'integer' },
              authUser: { type: 'string' },
              authPassword: { type: 'string' },
            },
          },
        },
      },
    },
  },
});

import { useDomainMappingStore } from '../../utils/services';

export default defineEventHandler(() => {
  return useDomainMappingStore().list();
});
