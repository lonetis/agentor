defineRouteMeta({
  openAPI: {
    tags: ['Containers'],
    summary: 'Get desktop status',
    description: 'Returns the status of the noVNC desktop service in a container.',
    operationId: 'getDesktopStatus',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Container ID' }],
    responses: {
      200: { description: 'Service status', content: { 'application/json': { schema: { type: 'object', properties: { running: { type: 'boolean' } } } } } },
      404: { description: 'Container not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useContainerManager } from '../../../../utils/services';

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')!;
  const containerManager = useContainerManager();
  return containerManager.getServiceStatus(id);
});
