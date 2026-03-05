defineRouteMeta({
  openAPI: {
    tags: ['Updates'],
    summary: 'Get update status',
    description: 'Returns image update status for all managed containers (orchestrator, mapper, worker, traefik).',
    operationId: 'getUpdateStatus',
    responses: {
      200: {
        description: 'Update status per image',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                orchestrator: { $ref: '#/components/schemas/ImageUpdateInfo' },
                mapper: { $ref: '#/components/schemas/ImageUpdateInfo' },
                worker: { $ref: '#/components/schemas/ImageUpdateInfo' },
                traefik: { $ref: '#/components/schemas/ImageUpdateInfo' },
                isProductionMode: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
    $global: {
      components: {
        schemas: {
          ImageUpdateInfo: {
            type: 'object',
            nullable: true,
            properties: {
              name: { type: 'string' },
              localDigest: { type: 'string' },
              remoteDigest: { type: 'string' },
              updateAvailable: { type: 'boolean' },
              lastChecked: { type: 'string', format: 'date-time' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
  },
});

import { useUpdateChecker } from '../../utils/services';

export default defineEventHandler(() => {
  return useUpdateChecker().getStatus();
});
