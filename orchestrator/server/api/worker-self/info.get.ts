defineRouteMeta({
  openAPI: {
    tags: ['Worker Self'],
    summary: 'Get the calling worker\'s identity',
    description: 'Returns the calling worker\'s name, container name, owning user id, and status as resolved by source IP. Useful for diagnostics and for confirming worker-self auth works from inside a container.',
    operationId: 'workerSelfInfo',
    responses: {
      200: { description: 'Worker identity' },
      401: { description: 'Caller IP did not resolve to a managed worker' },
    },
  },
});

import { requireWorkerSelf } from '../../utils/worker-auth';

export default defineEventHandler(async (event) => {
  const ctx = await requireWorkerSelf(event);
  return {
    workerId: ctx.workerId,
    containerName: ctx.containerName,
    userId: ctx.userId,
    status: ctx.container.status,
    // displayName is always populated for a running worker (defaulted to the
    // container name when no label was set), so no `?? null` is needed.
    displayName: ctx.container.displayName,
  };
});
