defineRouteMeta({
  openAPI: {
    tags: ['Account'],
    summary: "Get the current user's agent credential status",
    description: 'Returns the per-agent credential file status for the authenticated user. OpenCode stores API keys and OAuth credentials for multiple providers in one file. Account environment variables are reported separately. The files live under <DATA_DIR>/users/<userId>/credentials/ and are bind-mounted into every worker this user creates.',
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
                  zenAuthType: { type: 'string', enum: ['oauth', 'api-key', 'none'], description: 'OpenCode Zen auth, including the account API key. configured still describes saved credentials.' },
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
import { useUserCredentialManager, useUserEnvStore } from '../../utils/services';
import { getUserEnvVar } from '../../utils/user-env-store';
import type { CredentialInfo } from '../../../shared/types';

export default defineEventHandler(async (event): Promise<CredentialInfo[]> => {
  const { user } = requireAuth(event);
  // Read-only — `statusList` gracefully reports `configured: false` when the
  // credentials directory doesn't exist yet. The directory is created lazily
  // on the first mutation (reset endpoint or worker creation), so this GET
  // stays cheap and avoids filesystem writes on every modal open.
  const zenApiKeyConfigured = !!getUserEnvVar(useUserEnvStore().getOrDefault(user.id), 'OPENCODE_ZEN_API_KEY');
  return useUserCredentialManager().statusList(user.id, zenApiKeyConfigured);
});
