defineRouteMeta({
  openAPI: {
    tags: ['Worker Self'],
    summary: 'Trigger usage refresh for the calling worker owner',
    description: 'Forces an immediate refresh of usage data for the OAuth-authenticated agents owned by the user who owns the calling worker.',
    operationId: 'workerSelfRefreshUsage',
    responses: {
      200: { description: 'Refreshed usage status' },
      401: { description: 'Caller IP did not resolve to a managed worker' },
    },
  },
});

import { useUsageChecker } from '../../../utils/services';
import { requireWorkerSelf } from '../../../utils/worker-auth';

export default defineEventHandler(async (event) => {
  const ctx = await requireWorkerSelf(event);
  return useUsageChecker().refresh(ctx.userId);
});
