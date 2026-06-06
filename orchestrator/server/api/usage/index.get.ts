defineRouteMeta({
  openAPI: {
    tags: ['Usage'],
    summary: 'Get agent usage status',
    description: 'Returns usage monitoring data for the current user\'s OAuth-authenticated agents. Each user sees only their own usage — polling is per-user.',
    operationId: 'getUsage',
    responses: {
      200: {
        description: 'Agent usage status',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/AgentUsageStatus' } } },
      },
      401: { description: 'Unauthorized' },
    },
    $global: {
      components: {
        schemas: {
          AgentUsageInfo: {
            type: 'object',
            properties: {
              agentId: { type: 'string' },
              displayName: { type: 'string' },
              authType: { type: 'string', enum: ['oauth', 'api-key', 'none'] },
              usageAvailable: { type: 'boolean' },
              planType: { type: 'string', description: 'Plan/tier label when the upstream reports one (e.g. Codex)' },
              windows: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string' },
                    utilization: { type: 'number' },
                    resetsAt: { type: 'string', nullable: true },
                  },
                },
              },
              error: { type: 'string' },
              lastChecked: { type: 'string', description: 'ISO 8601 timestamp of the last fetch attempt' },
              lastFetchTime: { type: 'string', description: 'ISO 8601 timestamp of last successful fetch for this agent' },
            },
          },
          AgentUsageStatus: {
            type: 'object',
            properties: {
              agents: { type: 'array', items: { $ref: '#/components/schemas/AgentUsageInfo' } },
            },
          },
        },
      },
    },
  },
});

import { useUsageChecker } from '../../utils/services';
import { requireAuth } from '../../utils/auth-helpers';

export default defineEventHandler((event) => {
  const { user } = requireAuth(event);
  return useUsageChecker().getStatus(user.id);
});
