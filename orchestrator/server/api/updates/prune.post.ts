defineRouteMeta({
  openAPI: {
    tags: ['Updates'],
    summary: 'Prune dangling images',
    description: 'Removes dangling Docker images (untagged layers left behind by builds) to reclaim disk space.',
    operationId: 'pruneImages',
    responses: {
      200: {
        description: 'Prune result',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                imagesDeleted: { type: 'integer', description: 'Number of images removed' },
                spaceReclaimed: { type: 'integer', description: 'Bytes of disk space reclaimed' },
              },
            },
          },
        },
      },
    },
  },
});

import { useUpdateChecker } from '../../utils/services';
import { requireAdmin } from '../../utils/auth-helpers';

export default defineEventHandler(async (event) => {
  requireAdmin(event);
  const checker = useUpdateChecker();
  return checker.pruneImages();
});
