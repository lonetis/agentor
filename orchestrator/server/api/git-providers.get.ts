defineRouteMeta({
  openAPI: {
    tags: ['Config'],
    summary: 'List git providers',
    description: 'Returns available git provider configurations and whether the current user has a token configured for each.',
    operationId: 'listGitProviders',
    responses: {
      200: {
        description: 'Array of git providers',
        content: { 'application/json': { schema: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, displayName: { type: 'string' }, placeholder: { type: 'string' }, tokenConfigured: { type: 'boolean' } } } } } },
      },
      401: { description: 'Unauthorized' },
    },
  },
});

import { listGitProviders } from '../utils/git-providers';
import { useUserEnvStore } from '../utils/services';
import { getUserEnvVar } from '../utils/user-env-store';
import { requireAuth } from '../utils/auth-helpers';

export default defineEventHandler((event) => {
  const { user } = requireAuth(event);
  const env = useUserEnvStore().getOrDefault(user.id);
  return listGitProviders().map((p) => ({
    id: p.id,
    displayName: p.displayName,
    placeholder: p.placeholder,
    tokenConfigured: getUserEnvVar(env, p.tokenEnvVar).length > 0,
  }));
});
