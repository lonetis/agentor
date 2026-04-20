defineRouteMeta({
  openAPI: {
    tags: ['Account'],
    summary: "Update the current user's env vars",
    description: 'Upserts the env vars configured for the authenticated user. Well-known slots (GitHub token, agent API/OAuth keys) are individual fields; customEnvVars is a free-form list of additional `KEY=VALUE` pairs that will be injected into every worker that user creates. Keys must match [A-Z_][A-Z0-9_]* and cannot collide with reserved names (ENVIRONMENT, WORKER, ORCHESTRATOR_URL, etc.).',
    operationId: 'putAccountEnvVars',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
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
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'Updated env vars' },
      400: { description: 'Validation error (invalid key, reserved key, duplicate key)' },
      401: { description: 'Unauthorized' },
    },
  },
});

import { requireAuth } from '../../utils/auth-helpers';
import { useUserEnvStore } from '../../utils/services';
import type { UserEnvVars, UserEnvVarsInput } from '../../../shared/types';

export default defineEventHandler(async (event): Promise<UserEnvVars> => {
  const { user } = requireAuth(event);
  const body = await readBody<UserEnvVarsInput>(event);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Request body must be a JSON object' });
  }

  try {
    return await useUserEnvStore().upsert(user.id, body);
  } catch (err: unknown) {
    throw createError({
      statusCode: 400,
      statusMessage: err instanceof Error ? err.message : 'Invalid env vars',
    });
  }
});
