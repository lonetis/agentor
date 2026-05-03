defineRouteMeta({
  openAPI: {
    tags: ['Worker Self'],
    summary: 'Get the calling worker owner\'s agent usage status',
    description: 'Returns usage monitoring data for the OAuth-authenticated agents of the user who owns the calling worker. Caller is identified by source IP.',
    operationId: 'workerSelfGetUsage',
    responses: {
      200: { description: 'Agent usage status' },
      401: { description: 'Caller IP did not resolve to a managed worker' },
    },
  },
});

import { useUsageChecker } from '../../../utils/services';
import { requireWorkerSelf } from '../../../utils/worker-auth';

export default defineEventHandler(async (event) => {
  const ctx = await requireWorkerSelf(event);
  return useUsageChecker().getStatus(ctx.userId);
});
