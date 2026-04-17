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

  // Resolve worker by ID or name
  let containerInfo;
  if (body.workerId) {
    containerInfo = containerManager.get(body.workerId);
  } else if (body.workerName) {
    containerInfo = containerManager.list().find((c) => c.name === body.workerName);
  }
  if (!containerInfo || containerInfo.status !== 'running') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Worker container is not running',
    });
  }

  requireContainerAccess(event, containerInfo);

  const mapping = {
    externalPort: extPort,
    type: body.type as 'localhost' | 'external',
    workerId: containerInfo.id,
    workerName: containerInfo.name,
    internalPort: intPort,
    appType: body.appType as string | undefined,
    instanceId: body.instanceId as string | undefined,
    userId: containerInfo.userId,
  };

  await store.add(mapping);
  await useTraefikManager().reconcile();

  setResponseStatus(event, 201);
  return mapping;
});
