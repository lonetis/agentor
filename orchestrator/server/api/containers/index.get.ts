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
              mounts: { type: 'array', items: { $ref: '#/components/schemas/MountConfig' } },
              initScript: { type: 'string' },
              status: { type: 'string', enum: ['creating', 'running', 'stopped', 'removing', 'error'] },
              createdAt: { type: 'string', format: 'date-time' },
              image: { type: 'string' },
              imageId: { type: 'string' },
              environmentId: { type: 'string' },
              environmentName: { type: 'string' },
              cpuLimit: { type: 'number' },
              memoryLimit: { type: 'string' },
              networkMode: { type: 'string', enum: ['block-all', 'block', 'package-managers', 'full', 'custom'] },
              dockerEnabled: { type: 'boolean' },
              allowedDomains: { type: 'array', items: { type: 'string' } },
              includePackageManagerDomains: { type: 'boolean' },
              setupScript: { type: 'string' },
              envVars: { type: 'string' },
              exposeApis: { type: 'object', properties: { portMappings: { type: 'boolean' }, domainMappings: { type: 'boolean' }, usage: { type: 'boolean' } } },
              capabilityNames: { type: 'array', items: { type: 'string' } },
              instructionNames: { type: 'array', items: { type: 'string' } },
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
              ok: { type: 'boolean' },
            },
          },
        },
      },
    },
  },
});

import { useContainerManager } from '../../utils/services';
import { requireAuth } from '../../utils/auth-helpers';

export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event);
  const containerManager = useContainerManager();
  await containerManager.sync();
  const all = containerManager.list();
  if (user.role === 'admin') return all;
  return all.filter((c) => c.userId === user.id);
});
