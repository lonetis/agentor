defineRouteMeta({
  openAPI: {
    tags: ['Updates'],
    summary: 'Trigger update check',
    description: 'Triggers an immediate check for image updates.',
    operationId: 'triggerUpdateCheck',
    responses: {
      200: { description: 'Check triggered', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
    },
  },
});

import { useUpdateChecker } from '../../utils/services';
import { requireAdmin } from '../../utils/auth-helpers';

export default defineEventHandler(async (event) => {
  requireAdmin(event);
  return useUpdateChecker().check();
});
