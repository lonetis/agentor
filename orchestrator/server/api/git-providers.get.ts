defineRouteMeta({
  openAPI: {
    tags: ['Config'],
    summary: 'List git providers',
    description: 'Returns available git provider configurations.',
    operationId: 'listGitProviders',
    responses: {
      200: {
        description: 'Array of git providers',
        content: { 'application/json': { schema: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, displayName: { type: 'string' }, placeholder: { type: 'string' }, tokenConfigured: { type: 'boolean' } } } } } },
      },
    },
  },
});

import { listGitProviders } from '../utils/git-providers';
import { useConfig } from '../utils/services';

export default defineEventHandler(() => {
  const config = useConfig();
  return listGitProviders().map((p) => ({
    id: p.id,
    displayName: p.displayName,
    placeholder: p.placeholder,
    tokenConfigured: !!(config as unknown as Record<string, unknown>)[p.tokenConfigKey],
  }));
});
