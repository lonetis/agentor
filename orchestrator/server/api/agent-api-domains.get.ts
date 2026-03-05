defineRouteMeta({
  openAPI: {
    tags: ['Config'],
    summary: 'List agent API domains',
    description: 'Returns all API domains required by pre-installed agents (always allowed through the firewall in restricted modes).',
    operationId: 'listAgentApiDomains',
    responses: {
      200: {
        description: 'Array of domain strings',
        content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } },
      },
    },
  },
});

import { getAllAgentApiDomains } from '../utils/agent-config';

export default defineEventHandler((): string[] => {
  return getAllAgentApiDomains();
});
