defineRouteMeta({
  openAPI: {
    tags: ['Usage'],
    summary: 'Trigger usage refresh',
    description: 'Triggers an immediate refresh of the current user\'s agent usage data, bypassing the poll interval.',
    operationId: 'refreshUsage',
    responses: {
      200: { description: 'Refreshed usage status', content: { 'application/json': { schema: { $ref: '#/components/schemas/AgentUsageStatus' } } } },
      401: { description: 'Unauthorized' },
    },
  },
});

import { useUsageChecker } from '../../utils/services';
import { requireAuth } from '../../utils/auth-helpers';

export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event);
  return useUsageChecker().refresh(user.id);
});
