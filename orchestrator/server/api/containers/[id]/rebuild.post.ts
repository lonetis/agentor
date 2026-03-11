defineRouteMeta({
  openAPI: {
    tags: ['Containers'],
    summary: 'Rebuild container',
    description: 'Destroys and recreates a worker container with the latest image, preserving workspace data. Useful after pulling a new worker image.',
    operationId: 'rebuildContainer',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Container ID' }],
    responses: {
      200: { description: 'Container rebuilt', content: { 'application/json': { schema: { $ref: '#/components/schemas/ContainerInfo' } } } },
      404: { description: 'Container not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useContainerManager, cleanupWorkerMappings } from '../../../utils/services';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  try {
    await cleanupWorkerMappings(id);
    const containerInfo = await useContainerManager().rebuild(id);
    return containerInfo;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Operation failed';
    throw createError({ statusCode: 500, statusMessage: message });
  }
});
