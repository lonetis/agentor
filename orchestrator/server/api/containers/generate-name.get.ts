defineRouteMeta({
  openAPI: {
    tags: ['Containers'],
    summary: 'Generate container name',
    description: 'Returns a randomly generated per-user worker name that does not collide with the caller\'s existing workers.',
    operationId: 'generateContainerName',
    responses: {
      200: {
        description: 'Generated name',
        content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' } } } } },
      },
    },
  },
});

import { useContainerManager } from '../../utils/services';
import { requireAuth } from '../../utils/auth-helpers';

export default defineEventHandler((event) => {
  const { user } = requireAuth(event);
  return { name: useContainerManager().generateName(user.id) };
});
