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
            required: ['name'],
            properties: {
              name: { type: 'string', description: 'Repository name' },
              private: { type: 'boolean', description: 'Whether the repo is private' },
              description: { type: 'string', description: 'Repository description' },
            },
          },
        },
      },
    },
    responses: {
      201: { description: 'Created repository', content: { 'application/json': { schema: { type: 'object', properties: { full_name: { type: 'string' }, html_url: { type: 'string' } } } } } },
      400: { description: 'Error creating repo', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      401: { description: 'Unauthorized' },
    },
  },
});

import { getGitHubServiceForToken } from '../../utils/github';
import { requireAuth } from '../../utils/auth-helpers';
import { useUserEnvStore } from '../../utils/services';

export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event);
  const body = await readBody<{ owner: string; name: string; private: boolean }>(event);

  if (!body.owner || !body.name) {
    throw createError({ statusCode: 400, statusMessage: 'Missing owner or name' });
  }

  const token = useUserEnvStore().getOrDefault(user.id).githubToken;
  if (!token) {
    throw createError({ statusCode: 400, statusMessage: 'GitHub token not configured — set one in Account → API keys' });
  }

  const github = getGitHubServiceForToken(token);
  const repo = await github.createRepo(body.owner, body.name, body.private ?? false);
  return { repo };
});
