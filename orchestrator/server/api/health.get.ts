defineRouteMeta({
  openAPI: {
    tags: ['Health'],
    summary: 'Health check',
    description: 'Returns the orchestrator health status and the count of managed worker records (active workers — running + stopped; excludes archived workers and the Traefik/orchestrator containers).',
    operationId: 'healthCheck',
    responses: {
      200: {
        description: 'Health status',
        content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', example: 'ok' }, containers: { type: 'integer', description: 'Count of managed worker records (active workers, not literally running Docker containers)' } } } } },
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
