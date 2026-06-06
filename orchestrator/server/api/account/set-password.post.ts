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
  //
  // setPassword throws an APIError (e.g. PASSWORD_ALREADY_SET → 400) when the
  // user already has a password. Catch it explicitly so the contract stays a
  // 4xx even if better-auth changes its internal error shape, rather than
  // surfacing a raw 500.
  const auth = useAuth();
  try {
    await auth.api.setPassword({
      body: { newPassword },
      headers: event.headers,
    });
  } catch (err) {
    // better-auth's APIError carries a numeric `statusCode`; fall back to 400
    // (the password-already-set case) for any other error shape.
    const e = err as { statusCode?: number; message?: string };
    const code = typeof e?.statusCode === 'number' ? e.statusCode : 400;
    throw createError({
      statusCode: code,
      statusMessage: e?.message ?? 'Failed to set password',
    });
  }

  return { ok: true };
});
