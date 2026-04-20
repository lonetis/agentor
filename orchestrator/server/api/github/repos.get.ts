defineRouteMeta({
  openAPI: {
    tags: ['GitHub'],
    summary: 'List GitHub repos',
    description: 'Returns repositories accessible to the current user\'s GitHub account. The token comes from the caller\'s per-user Account settings.',
    operationId: 'listGitHubRepos',
    responses: {
      200: {
        description: 'Array of GitHub repositories',
        content: { 'application/json': { schema: { type: 'array', items: { type: 'object', properties: { full_name: { type: 'string' }, private: { type: 'boolean' }, default_branch: { type: 'string' } } } } } },
      },
      401: { description: 'Unauthorized' },
    },
  },
});

import { getGitHubServiceForToken } from '../../utils/github';
import { requireAuth } from '../../utils/auth-helpers';
import { useUserEnvStore } from '../../utils/services';

export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event);
  const token = useUserEnvStore().getOrDefault(user.id).githubToken;
  if (!token) {
    return { repos: [], tokenConfigured: false, username: '', orgs: [] as string[] };
  }

  const github = getGitHubServiceForToken(token);
  try {
    const [repos, ghUser, orgs] = await Promise.all([
      github.listRepos(),
      github.getUser(),
      github.listOrgs(),
    ]);
    return { repos, tokenConfigured: true, username: ghUser.login, orgs };
  } catch {
    return { repos: [], tokenConfigured: false, username: '', orgs: [] as string[] };
  }
});
