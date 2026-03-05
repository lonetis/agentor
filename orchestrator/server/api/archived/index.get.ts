defineRouteMeta({
  openAPI: {
    tags: ['Archived Workers'],
    summary: 'List archived workers',
    description: 'Returns all archived workers with their metadata.',
    operationId: 'listArchivedWorkers',
    responses: {
      200: {
        description: 'Array of archived workers',
        content: {
          'application/json': {
            schema: {
              type: 'array',
              items: { $ref: '#/components/schemas/ArchivedWorker' },
            },
          },
        },
      },
    },
    $global: {
      components: {
        schemas: {
          ArchivedWorker: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              displayName: { type: 'string' },
              createdAt: { type: 'string', format: 'date-time' },
              archivedAt: { type: 'string', format: 'date-time' },
              image: { type: 'string' },
              repos: { type: 'array', items: { $ref: '#/components/schemas/RepoConfig' } },
              environmentId: { type: 'string' },
              environmentName: { type: 'string' },
            },
          },
        },
      },
    },
  },
});

import { useContainerManager } from '../../utils/services';

export default defineEventHandler(() => {
  return useContainerManager().listArchived();
});
