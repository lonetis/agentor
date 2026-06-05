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
            description:
              'Minimal persisted worker record. Fields describing the live Docker container (containerId, containerName, imageName, imageId) are NOT stored — they are discovered at runtime via the agentor.id label and only present on the live ContainerInfo.',
            properties: {
              id: { type: 'string', description: 'Worker UUID — used to unarchive / delete' },
              userId: { type: 'string' },
              displayName: { type: 'string' },
              status: { type: 'string', enum: ['active', 'archived'] },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
              archivedAt: { type: 'string', format: 'date-time' },
              repos: { type: 'array', items: { $ref: '#/components/schemas/RepoConfig' } },
              mounts: { type: 'array', items: { $ref: '#/components/schemas/MountConfig' } },
              initScript: { type: 'string' },
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
