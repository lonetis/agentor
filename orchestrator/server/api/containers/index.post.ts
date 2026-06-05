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
              displayName: { type: 'string', description: 'Editable user-facing label (free-form; auto-generated friendly slug if omitted). The internal worker identity is a server-minted UUID.' },
              repos: { type: 'array', items: { $ref: '#/components/schemas/RepoConfig' } },
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

import { useContainerManager } from '../../utils/services';
import { MAX_DISPLAY_NAME_LENGTH } from '../../utils/validation';
import { requireAuth } from '../../utils/auth-helpers';

export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event);
  const body = await readBody(event);

  if (body.displayName != null && typeof body.displayName !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'displayName must be a string' });
  }
  if (typeof body.displayName === 'string' && body.displayName.trim().length > MAX_DISPLAY_NAME_LENGTH) {
    throw createError({ statusCode: 400, statusMessage: `displayName must be at most ${MAX_DISPLAY_NAME_LENGTH} characters` });
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

  // Resource limits are an environment property — no per-worker override. Git
  // identity is resolved live from the owning user, not passed in here.
  const containerManager = useContainerManager();
  const container = await containerManager.create({
    displayName: body.displayName || undefined,
    repos: parsedRepos,
    mounts: parsedMounts,
    environmentId: body.environmentId || undefined,
    initScript: body.initScript || undefined,
    userId: user.id,
  });

  setResponseStatus(event, 201);
  return container;
});
