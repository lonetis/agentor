defineRouteMeta({
  openAPI: {
    tags: ['Worker Self'],
    summary: 'Trigger usage refresh for the calling worker owner',
    description: 'Forces an immediate refresh of usage data for the OAuth-authenticated agents owned by the user who owns the calling worker.',
    operationId: 'workerSelfRefreshUsage',
    responses: {
      200: { description: 'Refreshed usage status' },
      401: { description: 'Caller IP did not resolve to a managed worker' },
      403: { description: 'Worker environment does not expose the usage API' },
    },
  },
});

import { useUsageChecker, useEnvironmentStore } from '../../../utils/services';
import { DEFAULT_ENVIRONMENT_ID } from '../../../utils/environments';
import { requireWorkerSelf } from '../../../utils/worker-auth';
import type { ExposeApis } from '../../../../shared/types';
import type { WorkerSelfContext } from '../../../utils/worker-auth';

// exposeApis gate — see port-mappings/index.post.ts for the full rationale.
function requireExposedApi(ctx: WorkerSelfContext, api: keyof ExposeApis): void {
  const env = useEnvironmentStore().getById(ctx.container.environmentId || DEFAULT_ENVIRONMENT_ID);
  if (env && env.exposeApis?.[api] === false) {
    throw createError({
      statusCode: 403,
      statusMessage: `This worker's environment does not expose the ${api} API (exposeApis.${api} is disabled).`,
    });
  }
}

export default defineEventHandler(async (event) => {
  const ctx = await requireWorkerSelf(event);
  requireExposedApi(ctx, 'usage');
  return useUsageChecker().refresh(ctx.userId);
});
