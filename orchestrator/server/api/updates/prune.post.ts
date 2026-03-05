defineRouteMeta({
  openAPI: {
    tags: ['Updates'],
    summary: 'Prune unused images',
    description: 'Removes all unused Docker images (dangling and unreferenced) to reclaim disk space.',
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

export default defineEventHandler(async () => {
  const checker = useUpdateChecker();
  return checker.pruneImages();
});
