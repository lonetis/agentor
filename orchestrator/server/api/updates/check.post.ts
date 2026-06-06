defineRouteMeta({
  openAPI: {
    tags: ['Updates'],
    summary: 'Trigger update check',
    description: 'Triggers an immediate check for image updates.',
    operationId: 'triggerUpdateCheck',
    responses: {
      200: {
        description: 'Update status after the check',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                orchestrator: { $ref: '#/components/schemas/ImageUpdateInfo' },
                worker: { $ref: '#/components/schemas/ImageUpdateInfo' },
                traefik: { $ref: '#/components/schemas/ImageUpdateInfo' },
                isProductionMode: { type: 'boolean' },
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
  return useUpdateChecker().check();
});
