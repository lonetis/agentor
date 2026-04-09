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

import { useContainerManager } from '../../../utils/services';
import { requireContainerAccess } from '../../../utils/auth-helpers';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  try {
    const cm = useContainerManager();
    requireContainerAccess(event, cm.get(id));
    const containerInfo = await cm.rebuild(id);
    return containerInfo;
  } catch (err: unknown) {
    if ((err as any)?.statusCode) throw err;
    const message = err instanceof Error ? err.message : 'Operation failed';
    throw createError({ statusCode: 500, statusMessage: message });
  }
});
