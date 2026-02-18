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
