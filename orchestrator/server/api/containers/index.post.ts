defineRouteMeta({
  openAPI: {
    tags: ['Containers'],
    summary: 'Create container',
    description: 'Creates a new worker container with the given configuration.',
    operationId: 'createContainer',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Container name (auto-generated if omitted)' },
              displayName: { type: 'string', description: 'Friendly display name' },
              repos: { type: 'array', items: { $ref: '#/components/schemas/RepoConfig' } },
              cpuLimit: { type: 'number', description: 'CPU core limit' },
              memoryLimit: { type: 'string', description: 'Memory limit (e.g. "2g")' },
              mounts: { type: 'array', items: { $ref: '#/components/schemas/MountConfig' } },
              environmentId: { type: 'string', description: 'Environment configuration ID' },
              initScript: { type: 'string', description: 'Init script to run on startup' },
            },
          },
        },
      },
    },
    responses: {
      201: { description: 'Created container info', content: { 'application/json': { schema: { $ref: '#/components/schemas/ContainerInfo' } } } },
      400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useContainerManager, useConfig } from '../../utils/services';
import { CONTAINER_NAME_RE } from '../../utils/validation';
import { requireAuth } from '../../utils/auth-helpers';

export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event);
  const body = await readBody(event);

  if (body.name) {
    const prefix = useConfig().containerPrefix + '-';
    const suffix = body.name.startsWith(prefix) ? body.name.slice(prefix.length) : body.name;
    if (!CONTAINER_NAME_RE.test(suffix)) {
      throw createError({ statusCode: 400, statusMessage: 'Container name must contain only lowercase letters (a-z), digits (0-9), and hyphens' });
    }
  }

  let parsedMounts;
  if (body.mounts) {
    if (typeof body.mounts === 'string') {
      try {
        parsedMounts = JSON.parse(body.mounts);
      } catch {
        throw createError({ statusCode: 400, statusMessage: 'Invalid mounts JSON' });
      }
    } else {
      parsedMounts = body.mounts;
    }
  }

  let parsedRepos;
  if (body.repos) {
    if (typeof body.repos === 'string') {
      try {
        parsedRepos = JSON.parse(body.repos);
      } catch {
        throw createError({ statusCode: 400, statusMessage: 'Invalid repos JSON' });
      }
    } else {
      parsedRepos = body.repos;
    }
  }

  const cpuLimit = body.cpuLimit != null ? parseFloat(body.cpuLimit) : undefined;
  if (cpuLimit !== undefined && (Number.isNaN(cpuLimit) || cpuLimit <= 0)) {
    throw createError({ statusCode: 400, statusMessage: 'cpuLimit must be a positive number' });
  }

  const containerManager = useContainerManager();
  const container = await containerManager.create({
    name: body.name || undefined,
    displayName: body.displayName || undefined,
    repos: parsedRepos,
    cpuLimit,
    memoryLimit: body.memoryLimit || undefined,
    mounts: parsedMounts,
    environmentId: body.environmentId || undefined,
    initScript: body.initScript || undefined,
    userId: user.id,
  });

  setResponseStatus(event, 201);
  return container;
});
