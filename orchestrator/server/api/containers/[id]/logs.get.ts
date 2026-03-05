defineRouteMeta({
  openAPI: {
    tags: ['Containers'],
    summary: 'Get container logs',
    description: 'Returns stdout/stderr logs from a worker container.',
    operationId: 'getContainerLogs',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Container ID' }],
    responses: {
      200: { description: 'Container logs as text', content: { 'text/plain': { schema: { type: 'string' } } } },
      404: { description: 'Container not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useContainerManager } from '../../../utils/services';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  const query = getQuery(event);
  const parsed = query.tail ? parseInt(query.tail as string, 10) : 200;
  const tail = isNaN(parsed) || parsed < 1 ? 200 : Math.min(parsed, 10000);
  const containerManager = useContainerManager();
  const logs = await containerManager.logs(id, tail);
  return { logs };
});
