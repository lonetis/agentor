defineRouteMeta({
  openAPI: {
    tags: ['Setup'],
    summary: 'Create initial admin',
    description: 'Creates the first admin user. Only works when no users exist.',
    operationId: 'createInitialAdmin',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['email', 'password', 'name'],
            properties: {
              email: { type: 'string' },
              password: { type: 'string' },
              name: { type: 'string' },
            },
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Admin user created',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                email: { type: 'string' },
                name: { type: 'string' },
                role: { type: 'string' },
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

import { hasAnyUsers, useAuth, setUserRoleDirect } from '../../utils/auth';

export default defineEventHandler(async (event) => {
  const auth = useAuth() as any;

  if (hasAnyUsers()) {
    throw createError({ statusCode: 409, statusMessage: 'Setup already completed' });
  }

  const body = await readBody<{ email?: string; password?: string; name?: string }>(event);
  const email = (body?.email || '').trim().toLowerCase();
  const password = body?.password || '';
  const name = (body?.name || '').trim();

  if (!email || !email.includes('@')) {
    throw createError({ statusCode: 400, statusMessage: 'Valid email required' });
  }
  if (!password || password.length < 8) {
    throw createError({ statusCode: 400, statusMessage: 'Password must be at least 8 characters' });
  }
  if (!name) {
    throw createError({ statusCode: 400, statusMessage: 'Name required' });
  }

  // Create the user via better-auth's sign-up flow (this also auto-signs-in)
  const result = await auth.api.signUpEmail({
    body: { email, password, name },
    asResponse: false,
    headers: event.headers,
  });

  const userId = (result as any)?.user?.id ?? (result as any)?.id;
  if (!userId) {
    throw createError({ statusCode: 500, statusMessage: 'Failed to create admin user' });
  }

  // Promote to admin role directly in the database — there is no admin session
  // yet to call the admin plugin's setRole endpoint.
  setUserRoleDirect(userId, 'admin');

  setResponseStatus(event, 201);
  return {
    id: userId,
    email,
    name,
    role: 'admin',
  };
});
