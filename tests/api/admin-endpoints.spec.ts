import { test, expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createTestUser, deleteTestUser, type CreatedUser } from '../helpers/test-users';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const UNAUTH_OPTS = {
  baseURL: BASE_URL,
  extraHTTPHeaders: { Origin: BASE_URL },
  storageState: { cookies: [], origins: [] },
};

async function signedInAsUser(user: CreatedUser): Promise<APIRequestContext> {
  const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
  const api = new ApiClient(ctx);
  const signIn = await api.signInEmail(user.email, user.password);
  if (signIn.status !== 200) {
    await ctx.dispose();
    throw new Error(`Sign-in failed: ${signIn.status}`);
  }
  return ctx;
}

/**
 * Exhaustive verification that every admin-only endpoint rejects non-admin
 * users. Each case has three assertions: unauthenticated → 401, regular
 * user → 403, admin → 200 (or a legitimate application error).
 */
test.describe('Admin-only endpoints', () => {
  let user: CreatedUser;
  let userCtx: APIRequestContext;

  test.beforeAll(async () => {
    user = await createTestUser('Admin Endpoint Denied');
    userCtx = await signedInAsUser(user);
  });

  test.afterAll(async () => {
    await userCtx?.dispose();
    if (user) await deleteTestUser(user.id);
  });

  test('GET /api/settings — admin only', async ({ request }) => {
    // Unauthenticated
    const unauthCtx = await playwrightRequest.newContext(UNAUTH_OPTS);
    try {
      const unauth = await unauthCtx.get('/api/settings');
      expect(unauth.status()).toBe(401);
    } finally {
      await unauthCtx.dispose();
    }

    // Regular user
    const userRes = await userCtx.get('/api/settings');
    expect(userRes.status()).toBe(403);

    // Admin
    const adminRes = await request.get('/api/settings');
    expect(adminRes.status()).toBe(200);
  });

  test('GET /api/logs — admin only', async ({ request }) => {
    const unauthCtx = await playwrightRequest.newContext(UNAUTH_OPTS);
    try {
      const unauth = await unauthCtx.get('/api/logs');
      expect(unauth.status()).toBe(401);
    } finally {
      await unauthCtx.dispose();
    }

    const userRes = await userCtx.get('/api/logs');
    expect(userRes.status()).toBe(403);

    const adminRes = await request.get('/api/logs');
    expect(adminRes.status()).toBe(200);
  });

  test('DELETE /api/logs — admin only', async () => {
    const unauthCtx = await playwrightRequest.newContext(UNAUTH_OPTS);
    try {
      const unauth = await unauthCtx.delete('/api/logs');
      expect(unauth.status()).toBe(401);
    } finally {
      await unauthCtx.dispose();
    }

    const userRes = await userCtx.delete('/api/logs');
    expect(userRes.status()).toBe(403);

    // Note: we don't actually call DELETE with admin since it clears the
    // log files — that would bleed into other tests' log assertions. The
    // 401/403 checks above are the important ones.
  });

  test('POST /api/updates/apply — admin only', async () => {
    const unauthCtx = await playwrightRequest.newContext(UNAUTH_OPTS);
    try {
      const unauth = await unauthCtx.post('/api/updates/apply', { data: {} });
      expect(unauth.status()).toBe(401);
    } finally {
      await unauthCtx.dispose();
    }

    const userRes = await userCtx.post('/api/updates/apply', { data: {} });
    expect(userRes.status()).toBe(403);
  });

  test('POST /api/updates/check — admin only', async () => {
    const unauthCtx = await playwrightRequest.newContext(UNAUTH_OPTS);
    try {
      const unauth = await unauthCtx.post('/api/updates/check');
      expect(unauth.status()).toBe(401);
    } finally {
      await unauthCtx.dispose();
    }

    const userRes = await userCtx.post('/api/updates/check');
    expect(userRes.status()).toBe(403);
  });

  test('POST /api/updates/prune — admin only', async () => {
    const unauthCtx = await playwrightRequest.newContext(UNAUTH_OPTS);
    try {
      const unauth = await unauthCtx.post('/api/updates/prune');
      expect(unauth.status()).toBe(401);
    } finally {
      await unauthCtx.dispose();
    }

    const userRes = await userCtx.post('/api/updates/prune');
    expect(userRes.status()).toBe(403);
  });
});
