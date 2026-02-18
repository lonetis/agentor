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
