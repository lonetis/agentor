defineRouteMeta({
  openAPI: {
    tags: ['Containers'],
    summary: 'List containers',
    description: 'Returns all managed worker containers with their current status.',
    operationId: 'listContainers',
    responses: {
      200: {
        description: 'Array of container info objects',
        content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/ContainerInfo' } } } },
      },
    },
    $global: {
      components: {
        schemas: {
          ContainerInfo: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              displayName: { type: 'string' },
              repos: { type: 'array', items: { $ref: '#/components/schemas/RepoConfig' } },
              status: { type: 'string', enum: ['creating', 'running', 'stopped', 'removing', 'error'] },
              createdAt: { type: 'string', format: 'date-time' },
              image: { type: 'string' },
              imageId: { type: 'string' },
              labels: { type: 'object', additionalProperties: { type: 'string' } },
            },
          },
          RepoConfig: {
            type: 'object',
            properties: {
              provider: { type: 'string' },
              url: { type: 'string' },
              branch: { type: 'string' },
            },
          },
          MountConfig: {
            type: 'object',
            properties: {
              source: { type: 'string' },
              target: { type: 'string' },
              readOnly: { type: 'boolean' },
            },
          },
          ErrorResponse: {
            type: 'object',
            properties: {
              statusCode: { type: 'integer' },
              statusMessage: { type: 'string' },
            },
          },
          SuccessResponse: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
            },
          },
        },
      },
    },
  },
});

import { useContainerManager } from '../../utils/services';

export default defineEventHandler(async () => {
  const containerManager = useContainerManager();
  await containerManager.sync();
  return containerManager.list();
});
