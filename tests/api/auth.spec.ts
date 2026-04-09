import { test, expect, request as playwrightRequest } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD } from '../global-setup';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// Create an unauthenticated request context. Pass an empty storageState to
// prevent inheritance of the project-level admin session.
const UNAUTH_OPTS = {
  baseURL: BASE_URL,
  extraHTTPHeaders: { Origin: BASE_URL },
  storageState: { cookies: [], origins: [] },
};

test.describe('Authentication', () => {
  test('admin session is valid for authenticated tests', async ({ request }) => {
    const api = new ApiClient(request);
    const { status, body } = await api.getAuthSession();
    expect(status).toBe(200);
    expect(body?.user?.email).toBe(TEST_ADMIN_EMAIL);
    expect(body?.user?.role).toBe('admin');
  });

  test('unauthenticated request returns 401 on protected API', async () => {
    const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
    try {
      const res = await ctx.get('/api/containers');
      expect(res.status()).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test('unauthenticated request can hit /api/health', async () => {
    const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
    try {
      const res = await ctx.get('/api/health');
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('ok');
    } finally {
      await ctx.dispose();
    }
  });

  test('unauthenticated request can hit /api/setup/status', async () => {
    const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
    try {
      const res = await ctx.get('/api/setup/status');
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(typeof body.needsSetup).toBe('boolean');
    } finally {
      await ctx.dispose();
    }
  });

  test('sign in with wrong password fails', async () => {
    const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
    try {
      const api = new ApiClient(ctx);
      const { status } = await api.signInEmail(TEST_ADMIN_EMAIL, 'wrong-password');
      expect(status).toBeGreaterThanOrEqual(400);
    } finally {
      await ctx.dispose();
    }
  });

  test('sign in with correct credentials creates a session', async () => {
    const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
    try {
      const api = new ApiClient(ctx);
      const signIn = await api.signInEmail(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
      expect(signIn.status).toBe(200);
      const session = await api.getAuthSession();
      expect(session.status).toBe(200);
      expect(session.body?.user?.email).toBe(TEST_ADMIN_EMAIL);
    } finally {
      await ctx.dispose();
    }
  });

  test('sign out clears the session', async () => {
    const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
    try {
      const api = new ApiClient(ctx);
      await api.signInEmail(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
      const before = await api.getAuthSession();
      expect(before.body?.user?.email).toBe(TEST_ADMIN_EMAIL);

      await api.signOut();
      const after = await api.getAuthSession();
      // After sign-out, session should be gone — the endpoint returns null user
      expect(after.body?.user).toBeFalsy();
    } finally {
      await ctx.dispose();
    }
  });
});
