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
import { requireAuth } from '../utils/auth-helpers';
import type { UserEnvVars } from '../../shared/types';

export default defineEventHandler((event) => {
  const { user } = requireAuth(event);
  const env = useUserEnvStore().getOrDefault(user.id);
  return listGitProviders().map((p) => {
    const value = env[p.userEnvKey as keyof UserEnvVars];
    return {
      id: p.id,
      displayName: p.displayName,
      placeholder: p.placeholder,
      tokenConfigured: typeof value === 'string' && value.length > 0,
    };
  });
});
