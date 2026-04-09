defineRouteMeta({
  openAPI: {
    tags: ['Containers'],
    summary: 'Stop VS Code tunnel',
    description: 'Stops the VS Code tunnel process in a container.',
    operationId: 'stopVsCodeTunnel',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Container ID' }],
    responses: {
      200: { description: 'Tunnel stopped', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
      404: { description: 'Container not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useContainerManager } from '../../../../utils/services';
import { requireContainerAccess } from '../../../../utils/auth-helpers';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  const containerManager = useContainerManager();
  requireContainerAccess(event, containerManager.get(id));
  await containerManager.stopVsCodeTunnel(id);
  return { ok: true };
});
