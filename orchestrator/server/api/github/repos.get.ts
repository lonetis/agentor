defineRouteMeta({
  openAPI: {
    tags: ['GitHub'],
    summary: 'List GitHub repos',
    description: 'Returns repositories accessible to the authenticated GitHub user.',
    operationId: 'listGitHubRepos',
    responses: {
      200: {
        description: 'Array of GitHub repositories',
        content: { 'application/json': { schema: { type: 'array', items: { type: 'object', properties: { full_name: { type: 'string' }, private: { type: 'boolean' }, default_branch: { type: 'string' } } } } } },
      },
    },
  },
});

import { useGitHubService } from '../../utils/services';

export default defineEventHandler(async () => {
  const github = useGitHubService();

  if (!github.hasToken) {
    return { repos: [], tokenConfigured: false, username: '', orgs: [] as string[] };
  }

  try {
    const [repos, user, orgs] = await Promise.all([
      github.listRepos(),
      github.getUser(),
      github.listOrgs(),
    ]);
    return { repos, tokenConfigured: true, username: user.login, orgs };
  } catch {
    return { repos: [], tokenConfigured: false, username: '', orgs: [] as string[] };
  }
});
