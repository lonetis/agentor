defineRouteMeta({
  openAPI: {
    tags: ['GitHub'],
    summary: 'List repo branches',
    description: 'Returns branches and default branch for a GitHub repository.',
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
    },
  },
});

import { useGitHubService } from '../../../../../utils/services';

export default defineEventHandler(async (event) => {
  const owner = getRouterParam(event, 'owner');
  const repo = getRouterParam(event, 'repo');

  if (!owner || !repo) {
    throw createError({ statusCode: 400, statusMessage: 'Missing owner or repo' });
  }

  const github = useGitHubService();

  if (!github.hasToken) {
    throw createError({ statusCode: 400, statusMessage: 'GitHub token not configured' });
  }

  const result = await github.listBranches(owner, repo);
  return result;
});
