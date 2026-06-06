defineRouteMeta({
  openAPI: {
    tags: ['Worker Self'],
    summary: 'Delete a domain mapping owned by the calling worker',
    description: 'Removes a domain mapping by id. Mapping must belong to the calling worker.',
    operationId: 'workerSelfDeleteDomainMapping',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: {
      200: { description: 'Domain mapping deleted (idempotent)' },
      401: { description: 'Caller IP did not resolve to a managed worker' },
      403: { description: 'Mapping is owned by a different worker, or the environment does not expose the domain-mappings API' },
    },
  },
});

import { useDomainMappingStore, useTraefikManager, useEnvironmentStore } from '../../../utils/services';
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
  requireExposedApi(ctx, 'domainMappings');
  const id = getRouterParam(event, 'id')!;

  const store = useDomainMappingStore();
  const existing = store.findById(id);
  if (!existing) {
    return { ok: true };
  }
  if (existing.item.containerName !== ctx.containerName) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: mapping is owned by a different worker' });
  }

  const removed = await store.remove(id);
  if (removed) {
    await useTraefikManager().reconcile();
  }
  return { ok: true };
});
