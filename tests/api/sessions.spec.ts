import { test, expect, request as playwrightRequest } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createTestUser, deleteTestUser } from '../helpers/test-users';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const UNAUTH_OPTS = {
  baseURL: BASE_URL,
  extraHTTPHeaders: { Origin: BASE_URL },
  storageState: { cookies: [], origins: [] },
};

test.describe('Session management', () => {
  test('sign-in returns user metadata with role', async () => {
    const user = await createTestUser('Session Meta');
    try {
      const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
      try {
        const api = new ApiClient(ctx);
        const signIn = await api.signInEmail(user.email, user.password);
        expect(signIn.status).toBe(200);
        expect(signIn.body?.user).toBeTruthy();
        expect(signIn.body?.user?.email).toBe(user.email);
        // The admin plugin defaults new users to role 'user'.
        expect(signIn.body?.user?.role).toBe('user');
      } finally {
        await ctx.dispose();
      }
    } finally {
      await deleteTestUser(user.id);
    }
  });

  test('get-session without cookie returns null', async () => {
    const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
    try {
      const api = new ApiClient(ctx);
      const session = await api.getAuthSession();
      expect(session.status).toBe(200);
      // better-auth returns null (not an error) for unauthenticated
      // get-session — this mirrors the Vue client's useSession hook.
      expect(session.body?.user).toBeFalsy();
    } finally {
      await ctx.dispose();
    }
  });

  test('multiple sessions for the same user coexist', async () => {
    const user = await createTestUser('Multi Session');
    try {
      // Sign in twice from two independent contexts — both should be valid.
      const ctx1 = await playwrightRequest.newContext(UNAUTH_OPTS);
      const ctx2 = await playwrightRequest.newContext(UNAUTH_OPTS);
      try {
        const api1 = new ApiClient(ctx1);
        const api2 = new ApiClient(ctx2);
        expect((await api1.signInEmail(user.email, user.password)).status).toBe(200);
        expect((await api2.signInEmail(user.email, user.password)).status).toBe(200);

        // Both sessions report the same user
        const s1 = await api1.getAuthSession();
        const s2 = await api2.getAuthSession();
        expect(s1.body?.user?.email).toBe(user.email);
        expect(s2.body?.user?.email).toBe(user.email);

        // Signing out from ctx1 should not invalidate ctx2
        await api1.signOut();
        const s2After = await api2.getAuthSession();
        expect(s2After.body?.user?.email).toBe(user.email);
      } finally {
        await ctx1.dispose();
        await ctx2.dispose();
      }
    } finally {
      await deleteTestUser(user.id);
    }
  });

  test('signing out from one context only clears that context', async () => {
    const user = await createTestUser('Signout Scope');
    try {
      const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
      try {
        const api = new ApiClient(ctx);
        expect((await api.signInEmail(user.email, user.password)).status).toBe(200);
        expect((await api.getAuthSession()).body?.user?.email).toBe(user.email);

        await api.signOut();
        // The context's cookies are cleared by the sign-out response's
        // Set-Cookie headers.
        const session = await api.getAuthSession();
        expect(session.body?.user).toBeFalsy();

        // Cannot access protected endpoints anymore
        const cs = await ctx.get('/api/containers');
        expect(cs.status()).toBe(401);
      } finally {
        await ctx.dispose();
      }
    } finally {
      await deleteTestUser(user.id);
    }
  });

  test('admin session reports admin role', async ({ request }) => {
    const api = new ApiClient(request);
    const session = await api.getAuthSession();
    expect(session.status).toBe(200);
    expect(session.body?.user?.role).toBe('admin');
  });

  test('sign-in with nonexistent email fails', async () => {
    const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
    try {
      const api = new ApiClient(ctx);
      const res = await api.signInEmail('no-such-user@test.example', 'anything');
      expect(res.status).not.toBe(200);
    } finally {
      await ctx.dispose();
    }
  });
});
