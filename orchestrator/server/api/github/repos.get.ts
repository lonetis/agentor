defineRouteMeta({
  openAPI: {
    tags: ['GitHub'],
    summary: 'List GitHub repos',
    description: 'Returns repositories accessible to the current user\'s GitHub account. The token comes from the caller\'s per-user Account settings.',
    operationId: 'listGitHubRepos',
    responses: {
      200: {
        description: 'GitHub repositories plus token/account context',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                repos: { type: 'array', items: { type: 'object', properties: { fullName: { type: 'string' }, private: { type: 'boolean' }, defaultBranch: { type: 'string' } } } },
                tokenConfigured: { type: 'boolean' },
                username: { type: 'string' },
                orgs: { type: 'array', items: { type: 'string' } },
                error: { type: 'string', description: 'Set when a token IS configured but the GitHub request failed (bad token, missing scopes, rate limit)' },
              },
            },
          },
        },
      },
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
  const token = getUserEnvVar(useUserEnvStore().getOrDefault(user.id), 'GITHUB_TOKEN');
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
  } catch (err) {
    // A token IS configured — surface the failure (bad token, missing scopes,
    // rate limit) instead of masquerading as "no token", so the UI can show a
    // real error rather than a silently-empty dropdown.
    return {
      repos: [] as never[],
      tokenConfigured: true,
      username: '',
      orgs: [] as string[],
      error: err instanceof Error ? err.message : 'GitHub request failed',
    };
  }
});
