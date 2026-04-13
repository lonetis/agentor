defineRouteMeta({
  openAPI: {
    tags: ['Setup'],
    summary: 'Issue a passkey-bound admin setup token',
    description: 'Returns a one-shot token that the browser passes as `context` to `passkey.addPasskey()` to create the initial admin via passkey-only registration. Only works when no users exist.',
    operationId: 'createAdminPasskeyToken',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['email', 'name'],
            properties: {
              email: { type: 'string' },
              name: { type: 'string' },
            },
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Token issued',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                token: { type: 'string' },
                expiresIn: { type: 'integer', description: 'Seconds until token expires' },
              },
            },
          },
        },
      },
      400: { description: 'Validation error' },
      409: { description: 'Setup already completed' },
    },
  },
});

import { hasAnyUsers, useAuth, isPasskeyEnabled } from '../../utils/auth';
import { createSetupToken } from '../../utils/setup-token-store';

export default defineEventHandler(async (event) => {
  useAuth(); // ensure auth tables exist

  if (!isPasskeyEnabled()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Passkey authentication is not enabled — set DASHBOARD_SUBDOMAIN + DASHBOARD_BASE_DOMAIN to serve the dashboard over HTTPS',
    });
  }

  if (hasAnyUsers()) {
    throw createError({ statusCode: 409, statusMessage: 'Setup already completed' });
  }

  const body = await readBody<{ email?: string; name?: string }>(event);
  const email = (body?.email || '').trim().toLowerCase();
  const name = (body?.name || '').trim();

  if (!email || !email.includes('@')) {
    throw createError({ statusCode: 400, statusMessage: 'Valid email required' });
  }
  if (!name) {
    throw createError({ statusCode: 400, statusMessage: 'Name required' });
  }

  const token = createSetupToken({
    email,
    name,
    role: 'admin',
    initialAdmin: true,
  });

  return { token, expiresIn: 5 * 60 };
});
