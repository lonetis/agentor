defineRouteMeta({
  openAPI: {
    tags: ['Account'],
    summary: "Get the current user's env vars",
    description: 'Returns the environment variables configured for the authenticated user. These are injected into every worker that user creates (agent API keys, GitHub token, custom env vars). Values are returned in plaintext — only the owner can call this endpoint.',
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
                githubToken: { type: 'string' },
                anthropicApiKey: { type: 'string' },
                claudeCodeOauthToken: { type: 'string' },
                openaiApiKey: { type: 'string' },
                geminiApiKey: { type: 'string' },
                customEnvVars: {
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
                updatedAt: { type: 'string' },
              },
              required: [
                'userId', 'githubToken', 'anthropicApiKey', 'claudeCodeOauthToken',
                'openaiApiKey', 'geminiApiKey', 'customEnvVars', 'updatedAt',
              ],
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
