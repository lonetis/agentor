defineRouteMeta({
  openAPI: {
    tags: ['Usage'],
    summary: 'Get agent usage status',
    description: 'Returns usage monitoring data for the current user\'s OAuth-authenticated agents. Each user sees only their own usage — polling is per-user.',
    operationId: 'getUsage',
    responses: {
      200: {
        description: 'Agent usage status',
        content: { 'application/json': { schema: { type: 'object', properties: { agents: { type: 'array', items: { type: 'object', properties: { agentId: { type: 'string' }, displayName: { type: 'string' }, authType: { type: 'string', enum: ['oauth', 'api-key', 'none'] }, usageAvailable: { type: 'boolean' }, windows: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, utilization: { type: 'number' }, resetsAt: { type: 'string', nullable: true } } } }, error: { type: 'string' }, lastFetchTime: { type: 'string', description: 'ISO 8601 timestamp of last successful fetch for this agent' } } } } } } } },
      },
      401: { description: 'Unauthorized' },
    },
  },
});

import { useUsageChecker } from '../../utils/services';
import { requireAuth } from '../../utils/auth-helpers';

export default defineEventHandler((event) => {
  const { user } = requireAuth(event);
  return useUsageChecker().getStatus(user.id);
});
