defineRouteMeta({
  openAPI: {
    tags: ['Containers'],
    summary: 'Suggest a display name',
    description: 'Returns a randomly generated friendly display-name slug (e.g. `happy-panda`) for pre-filling the create-worker form. The internal worker identity is a server-minted UUID — this is only a convenience label suggestion and does not need to be used.',
    operationId: 'suggestDisplayName',
    responses: {
      200: {
        description: 'Suggested display name',
        content: { 'application/json': { schema: { type: 'object', properties: { displayName: { type: 'string' } } } } },
      },
    },
  },
});

import { useContainerManager } from '../../utils/services';
import { requireAuth } from '../../utils/auth-helpers';

export default defineEventHandler((event) => {
  const { user } = requireAuth(event);
  return { displayName: useContainerManager().suggestDisplayName(user.id) };
});
