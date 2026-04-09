defineRouteMeta({
  openAPI: {
    tags: ['Containers'],
    summary: 'Get VS Code tunnel status',
    description: 'Returns the status of the VS Code tunnel in a container (stopped, auth_required, or running).',
    operationId: 'getVsCodeTunnelStatus',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Container ID' }],
    responses: {
      200: {
        description: 'Tunnel status',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                status: { type: 'string', enum: ['stopped', 'auth_required', 'running'] },
                machineName: { type: 'string' },
                authUrl: { type: 'string' },
                authCode: { type: 'string' },
              },
              required: ['status'],
            },
          },
        },
      },
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
  return containerManager.getVsCodeTunnelStatus(id);
});
