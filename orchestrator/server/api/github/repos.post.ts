defineRouteMeta({
  openAPI: {
    tags: ['GitHub'],
    summary: 'Create GitHub repo',
    description: 'Creates a new GitHub repository on behalf of the current user. Uses the caller\'s per-user GitHub token from Account settings.',
    operationId: 'createGitHubRepo',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['owner', 'name'],
            properties: {
              owner: { type: 'string', description: 'Repository owner (user or org login)' },
              name: { type: 'string', description: 'Repository name' },
              private: { type: 'boolean', description: 'Whether the repo is private' },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'Created repository', content: { 'application/json': { schema: { type: 'object', properties: { repo: { type: 'object', properties: { fullName: { type: 'string' }, private: { type: 'boolean' }, defaultBranch: { type: 'string' } } } } } } } },
      400: { description: 'Error creating repo', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      401: { description: 'Unauthorized' },
    },
  },
});

import { getGitHubServiceForToken } from '../../utils/github';
import { requireAuth } from '../../utils/auth-helpers';
import { useUserEnvStore } from '../../utils/services';
import { getUserEnvVar } from '../../utils/user-env-store';

export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event);
  const body = await readBody<{ owner: string; name: string; private: boolean }>(event);

  if (!body.owner || !body.name) {
    throw createError({ statusCode: 400, statusMessage: 'Missing owner or name' });
  }

  const token = getUserEnvVar(useUserEnvStore().getOrDefault(user.id), 'GITHUB_TOKEN');
  if (!token) {
    throw createError({ statusCode: 400, statusMessage: 'GitHub token not configured — set one in Account → API keys' });
  }

  const github = getGitHubServiceForToken(token);
  const repo = await github.createRepo(body.owner, body.name, body.private ?? false);
  return { repo };
});
