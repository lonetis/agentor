defineRouteMeta({
  openAPI: {
    tags: ['Account'],
    summary: 'Set a password for the current user',
    description: 'Sets a password without requiring the current one. Used by users who created their account via passkey-only flow and want to add a password as a backup credential. The user must already be signed in.',
    operationId: 'setOwnPassword',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['newPassword'],
            properties: {
              newPassword: { type: 'string' },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'Password set' },
      400: { description: 'Validation error' },
      401: { description: 'Unauthorized' },
    },
  },
});

import { requireAuth } from '../../utils/auth-helpers';
import { useAuth } from '../../utils/auth';

export default defineEventHandler(async (event) => {
  requireAuth(event);
  const body = await readBody<{ newPassword?: string }>(event);
  const newPassword = body?.newPassword || '';
  if (!newPassword || newPassword.length < 8) {
    throw createError({ statusCode: 400, statusMessage: 'Password must be at least 8 characters' });
  }

  // Use better-auth's internal `setPassword` server-only endpoint, which
  // hashes the password and writes it to the user's `account` row. The
  // session must be present (verified by the `sensitiveSessionMiddleware`
  // inside that endpoint), so we forward the original event headers.
  const auth = useAuth() as any;
  await auth.api.setPassword({
    body: { newPassword },
    headers: event.headers,
  });

  return { ok: true };
});
