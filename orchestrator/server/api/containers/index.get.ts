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
              id: { type: 'string', description: "Worker UUID — the stable identity used in all /api/containers/:id routes (unchanged across rebuild)." },
              userId: { type: 'string' },
              containerId: { type: 'string', description: 'Current Docker container ID (changes on every rebuild).' },
              containerName: { type: 'string', description: 'Docker container name — `<prefix>-<id>`.' },
              displayName: { type: 'string' },
              imageName: { type: 'string' },
              imageId: { type: 'string' },
              repos: { type: 'array', items: { $ref: '#/components/schemas/RepoConfig' } },
              mounts: { type: 'array', items: { $ref: '#/components/schemas/MountConfig' } },
              initScript: { type: 'string' },
              status: { type: 'string', enum: ['creating', 'running', 'stopped', 'removing', 'error'] },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
              environmentId: { type: 'string', description: 'FK to the assigned environment. The environment config (CPU/memory/network/docker/setup/env vars/exposed APIs/capabilities/instructions) is resolved live by this id and not copied onto the worker. Git identity is resolved live from `userId`.' },
              pendingRebuild: { type: 'boolean', description: 'True when rebuild-requiring settings were edited but not yet applied via rebuild.' },
            },
          },
          RepoConfig: {
            type: 'object',
            description: 'A git repository cloned into /workspace when the worker starts',
            properties: {
              provider: { type: 'string', description: 'Git provider id from list_git_providers: `github` (default), `gitlab`, or `gitlab-<name>` for a self-managed GitLab server. Private repos authenticate with the user\'s token for that provider (its `tokenEnvVar`, e.g. GITHUB_TOKEN / GITLAB_TOKEN).' },
              url: { type: 'string', description: 'Clone URL (e.g. https://gitlab.com/group/project) or the repository path on the provider (`owner/repo`, `group/subgroup/project` — a list_git_repos `fullName`)' },
              branch: { type: 'string', description: 'Branch to check out (default: the repository default branch)' },
            },
          },
          MountConfig: {
            type: 'object',
            description: 'A host directory bind-mounted into the worker',
            properties: {
              source: { type: 'string', description: 'Absolute path on the Docker host' },
              target: { type: 'string', description: 'Absolute path inside the worker' },
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
