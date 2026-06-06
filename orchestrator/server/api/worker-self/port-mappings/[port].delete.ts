defineRouteMeta({
  openAPI: {
    tags: ['Worker Self'],
    summary: 'Delete a port mapping owned by the calling worker',
    description: 'Removes a port mapping by its external port. Mapping must belong to the calling worker.',
    operationId: 'workerSelfDeletePortMapping',
    parameters: [{ name: 'port', in: 'path', required: true, schema: { type: 'integer' }, description: 'External port number' }],
    responses: {
      200: { description: 'Port mapping deleted (idempotent)' },
      400: { description: 'Invalid port number' },
      401: { description: 'Caller IP did not resolve to a managed worker' },
      403: { description: 'Mapping is owned by a different worker, or the environment does not expose the port-mappings API' },
    },
  },
});

import { usePortMappingStore, useTraefikManager, useEnvironmentStore } from '../../../utils/services';
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
  // Strict integer parse — `parseInt` would silently accept "8080abc" → 8080.
  const param = getRouterParam(event, 'port')!;
  const port = Number(param);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid port number' });
  }

  const store = usePortMappingStore();
  const existing = store.findByPort(port);
  if (!existing) {
    return { ok: true };
  }
  if (existing.item.containerName !== ctx.containerName) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: mapping is owned by a different worker' });
  }

  const removed = await store.remove(port);
  if (removed) {
    await useTraefikManager().reconcile();
  }
  return { ok: true };
});
