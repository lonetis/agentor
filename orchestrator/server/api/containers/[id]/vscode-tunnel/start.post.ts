defineRouteMeta({
  openAPI: {
    tags: ['Containers'],
    summary: 'Start VS Code tunnel',
    description: 'Starts the VS Code tunnel process in a container.',
    operationId: 'startVsCodeTunnel',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Container ID' }],
    responses: {
      200: { description: 'Tunnel started', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
      404: { description: 'Container not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useContainerManager } from '../../../../utils/services';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  const containerManager = useContainerManager();
  await containerManager.startVsCodeTunnel(id);
  return { ok: true };
});
