defineRouteMeta({
  openAPI: {
    tags: ['Worker Self'],
    summary: 'Create a port mapping for the calling worker',
    description: 'Maps an external host port to an internal port on the calling worker. Caller identity is derived from the source IP — workerId/workerName fields are not accepted.',
    operationId: 'workerSelfCreatePortMapping',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['externalPort', 'type', 'internalPort'],
            properties: {
              externalPort: { type: 'integer', description: 'Host port to expose (1-65535)' },
              type: { type: 'string', enum: ['localhost', 'external'], description: 'Binding type' },
              internalPort: { type: 'integer', description: 'Worker internal port (1-65535)' },
              appType: { type: 'string', description: 'Optional app type reference' },
              instanceId: { type: 'string', description: 'Optional app instance ID' },
            },
          },
        },
      },
    },
    responses: {
      201: { description: 'Created port mapping', content: { 'application/json': { schema: { $ref: '#/components/schemas/PortMapping' } } } },
      400: { description: 'Validation error' },
      401: { description: 'Caller IP did not resolve to a managed worker' },
      403: { description: 'Worker environment does not expose the port-mappings API' },
      409: { description: 'External port already mapped' },
    },
  },
});

import { usePortMappingStore, useTraefikManager, useEnvironmentStore } from '../../../utils/services';
import { TraefikPortConflictError } from '../../../utils/traefik-manager';
import { DEFAULT_ENVIRONMENT_ID } from '../../../utils/environments';
import { requireWorkerSelf } from '../../../utils/worker-auth';
import type { ExposeApis } from '../../../../shared/types';
import type { WorkerSelfContext } from '../../../utils/worker-auth';

// Enforces the worker environment's `exposeApis` gate. `requireWorkerSelf` only
// proves WHICH worker is calling — it does not consult the environment. This
// makes the server actually refuse a route (403) the operator disabled via
// `exposeApis`, instead of the flag being documentation-only. Inlined per
// handler because every file under server/api/** is registered as a route, so
// a shared helper file here cannot exist. See the sibling worker-self handlers
// for the same block (domain-mappings/*, usage/*). Fails open on an
// unresolvable environment (the default config exposes all APIs).
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
  const body = await readBody(event);

  if (!body.externalPort || !body.type || !body.internalPort) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing required fields: externalPort, type, internalPort',
    });
  }

  const extPort = Number(body.externalPort);
  const intPort = Number(body.internalPort);
  if (!Number.isInteger(extPort) || extPort < 1 || extPort > 65535
    || !Number.isInteger(intPort) || intPort < 1 || intPort > 65535) {
    throw createError({
      statusCode: 400,
      statusMessage: 'externalPort and internalPort must be integers between 1 and 65535',
    });
  }

  if (body.type !== 'localhost' && body.type !== 'external') {
    throw createError({
      statusCode: 400,
      statusMessage: 'type must be "localhost" or "external"',
    });
  }

  const store = usePortMappingStore();
  const traefik = useTraefikManager();

  // Reject ports reserved for Traefik's 80/443 web entrypoints up front.
  try {
    traefik.assertPortAcceptable(extPort);
  } catch (err) {
    if (err instanceof TraefikPortConflictError) {
      throw createError({ statusCode: 409, statusMessage: err.message });
    }
    throw err;
  }

  let created;
  try {
    created = await store.add({
      externalPort: extPort,
      type: body.type as 'localhost' | 'external',
      workerId: ctx.container.id,
      containerName: ctx.containerName,
      internalPort: intPort,
      appType: body.appType as string | undefined,
      instanceId: body.instanceId as string | undefined,
      userId: ctx.userId,
    });
  } catch (err) {
    // `add()` throws on a duplicate external port — surface a 409, mirroring
    // the domain-mapping handlers (previously this leaked as a 500).
    throw createError({
      statusCode: 409,
      statusMessage: err instanceof Error ? err.message : 'Port is already mapped',
    });
  }

  // Apply transactionally — on a host-port bind failure, Traefik rolls back to
  // its last-good config and rejects, so we drop the just-persisted mapping and
  // return 409 instead of wedging Traefik on a port that can't be bound.
  try {
    await traefik.reconcileStrict();
  } catch (err) {
    await store.remove(created.externalPort).catch(() => {});
    throw createError({
      statusCode: 409,
      statusMessage: err instanceof Error ? err.message : 'Failed to apply port mapping',
    });
  }

  setResponseStatus(event, 201);
  return created;
});
