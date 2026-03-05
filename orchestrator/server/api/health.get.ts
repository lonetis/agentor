defineRouteMeta({
  openAPI: {
    tags: ['Health'],
    summary: 'Health check',
    description: 'Returns the orchestrator health status and active container count.',
    operationId: 'healthCheck',
    responses: {
      200: {
        description: 'Health status',
        content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', example: 'ok' }, containers: { type: 'integer' } } } } },
      },
    },
  },
});

import { useContainerManager } from '../utils/services';

export default defineEventHandler(() => {
  const containerManager = useContainerManager();
  return {
    status: 'ok',
    containers: containerManager.list().length,
  };
});
