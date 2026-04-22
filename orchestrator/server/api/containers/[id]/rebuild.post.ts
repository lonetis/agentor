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
import { rethrowAsHttpError } from '../../../utils/http-errors';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  try {
    const cm = useContainerManager();
    requireContainerAccess(event, cm.get(id));
    return await cm.rebuild(id);
  } catch (err) {
    rethrowAsHttpError(err);
  }
});
