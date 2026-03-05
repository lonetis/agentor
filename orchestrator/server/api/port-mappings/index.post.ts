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
            required: ['externalPort', 'type', 'workerId', 'internalPort'],
            properties: {
              externalPort: { type: 'integer', description: 'Host port to expose' },
              type: { type: 'string', enum: ['localhost', 'external'], description: 'Binding type' },
              workerId: { type: 'string', description: 'Target worker container ID' },
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

import { usePortMappingStore, useMapperManager, useContainerManager } from '../../utils/services';

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (!body.externalPort || !body.type || !body.workerId || !body.internalPort) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing required fields: externalPort, type, workerId, internalPort',
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

  const containerInfo = containerManager.get(body.workerId);
  if (!containerInfo || containerInfo.status !== 'running') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Worker container is not running',
    });
  }

  const mapping = {
    externalPort: extPort,
    type: body.type as 'localhost' | 'external',
    workerId: body.workerId as string,
    workerName: containerInfo.name,
    internalPort: intPort,
    appType: body.appType as string | undefined,
    instanceId: body.instanceId as string | undefined,
  };

  await store.add(mapping);
  await useMapperManager().reconcile();

  setResponseStatus(event, 201);
  return mapping;
});
