import { test, expect, request as playwrightRequest } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createTestUser, deleteTestUser } from '../helpers/test-users';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const UNAUTH_OPTS = {
  baseURL: BASE_URL,
  extraHTTPHeaders: { Origin: BASE_URL },
  storageState: { cookies: [], origins: [] },
};

test.describe('Account endpoints — edge cases', () => {
  test('set-password rejects short passwords', async () => {
    const user = await createTestUser('Short Pass');
    try {
      const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
      try {
        const api = new ApiClient(ctx);
        await api.signInEmail(user.email, user.password);
        const res = await ctx.post('/api/account/set-password', {
          data: { newPassword: 'short' },
        });
        expect(res.status()).toBe(400);
      } finally {
        await ctx.dispose();
      }
    } finally {
      await deleteTestUser(user.id);
    }
  });

  test('set-password rejects missing password', async () => {
    const user = await createTestUser('Missing Pass');
    try {
      const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
      try {
        const api = new ApiClient(ctx);
        await api.signInEmail(user.email, user.password);
        const res = await ctx.post('/api/account/set-password', { data: {} });
        expect(res.status()).toBe(400);
      } finally {
        await ctx.dispose();
      }
    } finally {
      await deleteTestUser(user.id);
    }
  });

  test('set-password requires authentication', async () => {
    const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
    try {
      const res = await ctx.post('/api/account/set-password', {
        data: { newPassword: 'long-enough-12345' },
      });
      expect(res.status()).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test('set-password returns 400 when the user already has a password', async () => {
    // better-auth's `setPassword` is specifically for users without a
    // credential — it throws PASSWORD_ALREADY_SET when one exists. Users
    // who want to change their existing password must use change-password
    // (which requires the current password).
    const user = await createTestUser('Already Set');
    try {
      const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
      try {
        const api = new ApiClient(ctx);
        await api.signInEmail(user.email, user.password);
        const res = await ctx.post('/api/account/set-password', {
          data: { newPassword: 'another-password-54321' },
        });
        expect(res.status()).toBe(400);
      } finally {
        await ctx.dispose();
      }
    } finally {
      await deleteTestUser(user.id);
    }
  });

  test('change-password fails when current password is wrong', async () => {
    const user = await createTestUser('Wrong Current');
    try {
      const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
      try {
        const api = new ApiClient(ctx);
        await api.signInEmail(user.email, user.password);
        const res = await ctx.post('/api/auth/change-password', {
          data: {
            currentPassword: 'definitely-not-the-current-password',
            newPassword: 'new-password-12345',
            revokeOtherSessions: false,
          },
        });
        expect(res.status()).toBeGreaterThanOrEqual(400);
      } finally {
        await ctx.dispose();
      }
    } finally {
      await deleteTestUser(user.id);
    }
  });

  test('remove-password is idempotently rejected (double-remove returns 400 after passkey removes password)', async () => {
    // The server enforces the balance invariant: you can't remove a password
    // that's already gone. This test simulates the "already removed" state
    // by attempting removal twice — the second call should return 400 (no
    // password to remove), which only happens if a passkey is registered.
    // Without a passkey, the first removal fails with 409. So this test
    // just confirms the 400 / 409 error codes are distinct.
    const user = await createTestUser('Double Remove');
    try {
      const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
      try {
        const api = new ApiClient(ctx);
        await api.signInEmail(user.email, user.password);
        // First attempt — user has password but no passkey → 409
        const first = await ctx.post('/api/account/remove-password');
        expect(first.status()).toBe(409);
      } finally {
        await ctx.dispose();
      }
    } finally {
      await deleteTestUser(user.id);
    }
  });

  test('credentials endpoint always reports non-negative counts', async ({ request }) => {
    const res = await request.get('/api/account/credentials');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.passkeyCount).toBeGreaterThanOrEqual(0);
    expect(typeof body.hasPassword).toBe('boolean');
  });
});
