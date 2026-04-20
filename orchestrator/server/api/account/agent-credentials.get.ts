defineRouteMeta({
  openAPI: {
    tags: ['Account'],
    summary: "Get the current user's agent OAuth credential status",
    description: 'Returns the per-agent credential file status for the authenticated user. Each entry reports whether a non-empty OAuth credential file exists for that agent. The files live under <DATA_DIR>/users/<userId>/credentials/ and are bind-mounted into every worker this user creates.',
    operationId: 'getAccountAgentCredentials',
    responses: {
      200: {
        description: 'Per-agent credential status',
        content: {
          'application/json': {
            schema: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  agentId: { type: 'string' },
                  fileName: { type: 'string' },
                  configured: { type: 'boolean' },
                },
                required: ['agentId', 'fileName', 'configured'],
              },
            },
          },
        },
      },
      401: { description: 'Unauthorized' },
    },
  },
});

import { requireAuth } from '../../utils/auth-helpers';
import { useUserCredentialManager } from '../../utils/services';
import type { CredentialInfo } from '../../../shared/types';

export default defineEventHandler(async (event): Promise<CredentialInfo[]> => {
  const { user } = requireAuth(event);
  // Read-only — `statusList` gracefully reports `configured: false` when the
  // credentials directory doesn't exist yet. The directory is created lazily
  // on the first mutation (reset endpoint or worker creation), so this GET
  // stays cheap and avoids filesystem writes on every modal open.
  return useUserCredentialManager().statusList(user.id);
});
