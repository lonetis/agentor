defineRouteMeta({
  openAPI: {
    tags: ['Account'],
    summary: "Get the current user's env vars",
    description: 'Returns the environment variables configured for the authenticated user as a uniform `envVars` list (predefined + custom alike, keyed by env var name). These are injected into every worker that user creates. Values are returned in plaintext — only the owner can call this endpoint. The SSH public key is not an env var; see `/api/account/ssh-key`.',
    operationId: 'getAccountEnvVars',
    responses: {
      200: {
        description: 'User env vars',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                userId: { type: 'string' },
                createdAt: { type: 'string' },
                updatedAt: { type: 'string' },
                envVars: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      key: { type: 'string' },
                      value: { type: 'string' },
                    },
                    required: ['key', 'value'],
                  },
                },
              },
              required: ['userId', 'createdAt', 'updatedAt', 'envVars'],
            },
          },
        },
      },
      401: { description: 'Unauthorized' },
    },
  },
});

import { requireAuth } from '../../utils/auth-helpers';
import { useUserEnvStore } from '../../utils/services';
import type { UserEnvVars } from '../../../shared/types';

export default defineEventHandler((event): UserEnvVars => {
  const { user } = requireAuth(event);
  return useUserEnvStore().getOrDefault(user.id);
});
