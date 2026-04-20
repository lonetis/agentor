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
              wildcard: { type: 'boolean', description: 'Also match any single-label prefix (e.g. *.sub.domain.com). Requires base domain challenge type of none, dns, or selfsigned.' },
              workerName: { type: 'string', description: 'Per-user worker name' },
              containerName: { type: 'string', description: 'Globally unique Docker container name' },
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
import { requireAuth } from '../../utils/auth-helpers';

export default defineEventHandler((event) => {
  const { user } = requireAuth(event);
  const all = useDomainMappingStore().list();
  if (user.role === 'admin') return all;
  return all.filter((m) => m.userId === user.id);
});
