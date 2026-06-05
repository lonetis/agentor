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
              id: { type: 'string', description: 'Worker UUID — used to unarchive / delete' },
              userId: { type: 'string' },
              containerName: { type: 'string' },
              displayName: { type: 'string' },
              imageName: { type: 'string' },
              imageId: { type: 'string' },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
              archivedAt: { type: 'string', format: 'date-time' },
              repos: { type: 'array', items: { $ref: '#/components/schemas/RepoConfig' } },
              environmentId: { type: 'string' },
            },
          },
        },
      },
    },
  },
});

import { useContainerManager } from '../../utils/services';
import { requireAuth } from '../../utils/auth-helpers';

export default defineEventHandler((event) => {
  const { user } = requireAuth(event);
  const all = useContainerManager().listArchived();
  if (user.role === 'admin') return all;
  return all.filter((w) => w.userId === user.id);
});
