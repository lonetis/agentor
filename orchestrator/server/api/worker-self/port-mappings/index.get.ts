defineRouteMeta({
  openAPI: {
    tags: ['Worker Self'],
    summary: 'List the calling worker\'s port mappings',
    description: 'Returns port mappings owned by the worker container that issued the request. Caller is identified by source IP on the agentor-net Docker network — no session cookie required.',
    operationId: 'workerSelfListPortMappings',
    responses: {
      200: {
        description: 'Array of port mappings owned by the calling worker',
        content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/PortMapping' } } } },
      },
      401: { description: 'Caller IP did not resolve to a managed worker' },
      403: { description: 'Worker environment does not expose the port-mappings API' },
    },
  },
});

import { usePortMappingStore, useEnvironmentStore } from '../../../utils/services';
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
  requireExposedApi(ctx, 'portMappings');
  return usePortMappingStore().list().filter((m) => m.containerName === ctx.containerName);
});
