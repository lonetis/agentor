defineRouteMeta({
  openAPI: {
    tags: ['Containers'],
    summary: 'Create container',
    description: 'Creates and starts a new worker: an isolated Ubuntu container with the Claude Code, Codex and Gemini CLIs, a persistent /workspace, a tmux session, a virtual desktop and VS Code. Returns once the container runs — setup (repo cloning, environment setup script) then continues inside, and the init script finally starts in tmux window 0. The returned `id` (a UUID) identifies the worker in every other worker operation.',
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
              environmentId: { type: 'string', description: 'Environment id (resources, network policy, Docker, capabilities, instructions); default environment if omitted' },
              initScript: { type: 'string', description: 'Bash run in tmux window 0 once setup finished — typically the content of an init script (e.g. the built-in `claude` one launches Claude Code). Empty = a plain shell.' },
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
import { MAX_DISPLAY_NAME_LENGTH } from '../../utils/validation';
import { validateMounts } from '../../utils/docker';
import { requireAuth } from '../../utils/auth-helpers';
import { parseRepoConfigs } from '../../utils/git-providers';
import type { RepoConfig } from '../../../shared/types';

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

  if (parsedMounts != null && !Array.isArray(parsedMounts)) {
    throw createError({ statusCode: 400, statusMessage: 'mounts must be an array' });
  }
  const mountError = validateMounts(parsedMounts, useConfig().dataDir);
  if (mountError) {
    throw createError({ statusCode: 400, statusMessage: mountError });
  }

  let parsedRepos: RepoConfig[] | undefined;
  if (body.repos) {
    let rawRepos: unknown = body.repos;
    if (typeof rawRepos === 'string') {
      try {
        rawRepos = JSON.parse(rawRepos);
      } catch {
        throw createError({ statusCode: 400, statusMessage: 'Invalid repos JSON' });
      }
    }
    const result = parseRepoConfigs(rawRepos);
    if ('error' in result) throw createError({ statusCode: 400, statusMessage: result.error });
    parsedRepos = result.repos;
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
