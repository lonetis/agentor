defineRouteMeta({
  openAPI: {
    tags: ['Usage'],
    summary: 'Trigger usage refresh',
    description: 'Triggers an immediate refresh of all agent usage data, bypassing the poll interval.',
    operationId: 'refreshUsage',
    responses: {
      200: { description: 'Refreshed usage status', content: { 'application/json': { schema: { $ref: '#/components/schemas/AgentUsageStatus' } } } },
    },
  },
});

import { useUsageChecker } from '../../utils/services';

export default defineEventHandler(async () => {
  return useUsageChecker().refresh();
});
