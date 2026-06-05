defineRouteMeta({
  openAPI: {
    tags: ['GitHub'],
    summary: 'List repo branches',
    description: 'Returns branches and default branch for a GitHub repository. Uses the caller\'s per-user GitHub token.',
    operationId: 'listRepoBranches',
    parameters: [
      { name: 'owner', in: 'path', required: true, schema: { type: 'string' }, description: 'Repository owner' },
      { name: 'repo', in: 'path', required: true, schema: { type: 'string' }, description: 'Repository name' },
    ],
    responses: {
      200: {
        description: 'Branches info',
        content: { 'application/json': { schema: { type: 'object', properties: { branches: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' } } } }, defaultBranch: { type: 'string' } } } } },
      },
      401: { description: 'Unauthorized' },
    },
  },
});

import { getGitHubServiceForToken } from '../../../../../utils/github';
import { requireAuth } from '../../../../../utils/auth-helpers';
import { useUserEnvStore } from '../../../../../utils/services';
import { getUserEnvVar } from '../../../../../utils/user-env-store';

export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event);
  const owner = getRouterParam(event, 'owner');
  const repo = getRouterParam(event, 'repo');

  if (!owner || !repo) {
    throw createError({ statusCode: 400, statusMessage: 'Missing owner or repo' });
  }

  const token = getUserEnvVar(useUserEnvStore().getOrDefault(user.id), 'GITHUB_TOKEN');
  if (!token) {
    throw createError({ statusCode: 400, statusMessage: 'GitHub token not configured — set one in Account → API keys' });
  }

  const github = getGitHubServiceForToken(token);
  return github.listBranches(owner, repo);
});
