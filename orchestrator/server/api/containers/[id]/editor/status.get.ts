defineRouteMeta({
  openAPI: {
    tags: ['Containers'],
    summary: 'Get editor status',
    description: 'Returns the status of the code-server editor in a container.',
    operationId: 'getEditorStatus',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Container ID' }],
    responses: {
      200: { description: 'Service status', content: { 'application/json': { schema: { type: 'object', properties: { running: { type: 'boolean' } } } } } },
      404: { description: 'Container not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useContainerManager } from '../../../../utils/services';
import { requireContainerAccess } from '../../../../utils/auth-helpers';

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')!;
  const containerManager = useContainerManager();
  requireContainerAccess(event, containerManager.get(id));
  return containerManager.getServiceStatus(id);
});
