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
    },
  },
});

import { usePortMappingStore, useTraefikManager } from '../../../utils/services';
import { requireWorkerSelf } from '../../../utils/worker-auth';

export default defineEventHandler(async (event) => {
  const ctx = await requireWorkerSelf(event);
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

  const mapping = {
    externalPort: extPort,
    type: body.type as 'localhost' | 'external',
    workerName: ctx.container.name,
    containerName: ctx.containerName,
    internalPort: intPort,
    appType: body.appType as string | undefined,
    instanceId: body.instanceId as string | undefined,
    userId: ctx.userId,
  };

  await usePortMappingStore().add(mapping);
  await useTraefikManager().reconcile();

  setResponseStatus(event, 201);
  return mapping;
});
