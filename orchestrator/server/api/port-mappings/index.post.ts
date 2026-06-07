defineRouteMeta({
  openAPI: {
    tags: ['Port Mappings'],
    summary: 'Create port mapping',
    description: 'Creates a new TCP port mapping from an external port to a worker internal port.',
    operationId: 'createPortMapping',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['externalPort', 'type', 'internalPort'],
            properties: {
              externalPort: { type: 'integer', description: 'Host port to expose' },
              type: { type: 'string', enum: ['localhost', 'external'], description: 'Binding type' },
              workerId: { type: 'string', description: 'Target worker container ID (either workerId or workerName required)' },
              workerName: { type: 'string', description: 'Target worker container name (either workerId or workerName required)' },
              internalPort: { type: 'integer', description: 'Worker internal port' },
              appType: { type: 'string', description: 'Optional app type reference' },
              instanceId: { type: 'string', description: 'Optional app instance ID' },
            },
          },
        },
      },
    },
    responses: {
      201: { description: 'Created port mapping', content: { 'application/json': { schema: { $ref: '#/components/schemas/PortMapping' } } } },
      400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { usePortMappingStore, useTraefikManager, useContainerManager } from '../../utils/services';
import { TraefikPortConflictError } from '../../utils/traefik-manager';
import { requireContainerAccess } from '../../utils/auth-helpers';

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (!body.externalPort || !body.type || (!body.workerId && !body.workerName) || !body.internalPort) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing required fields: externalPort, type, workerId or workerName, internalPort',
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
  const containerManager = useContainerManager();

  // Resolve worker by worker UUID `id` (UI dropdown), globally unique container
  // name (worker-facing API shortcut via `WORKER_CONTAINER_NAME`), or the
  // worker `id`. All paths converge on a ContainerInfo.
  let containerInfo;
  if (body.workerId) {
    containerInfo = containerManager.get(body.workerId);
  } else if (body.workerName) {
    containerInfo = containerManager.findByContainerName(body.workerName)
      ?? containerManager.get(body.workerName as string);
  }
  if (!containerInfo || containerInfo.status !== 'running') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Worker container is not running',
    });
  }

  requireContainerAccess(event, containerInfo);

  const traefik = useTraefikManager();

  // Reject ports reserved for Traefik's own 80/443 web entrypoints before
  // persisting — these can never back a mapping while domain routing/dashboard
  // is active (a pm-<port> entrypoint on 80/443 would stop Traefik booting).
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
      workerId: containerInfo.id,
      containerName: containerInfo.containerName,
      internalPort: intPort,
      appType: body.appType as string | undefined,
      instanceId: body.instanceId as string | undefined,
      userId: containerInfo.userId,
    });
  } catch (err) {
    // `add()` throws on a duplicate external port — surface a 409, matching the
    // worker-self handler (previously this leaked as a 500).
    throw createError({
      statusCode: 409,
      statusMessage: err instanceof Error ? err.message : 'Port is already mapped',
    });
  }

  // Apply transactionally. If the host port can't be bound, the strict reconcile
  // rolls Traefik back to its last-good config and rejects — so we drop the
  // just-persisted mapping and return 409, rather than leaving a broken mapping
  // that would re-break Traefik on every future reconcile/restart.
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
