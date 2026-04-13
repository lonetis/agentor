import { test, expect, request as playwrightRequest } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createTestUser, deleteTestUser } from '../helpers/test-users';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN_STORAGE = resolve(__dirname, '..', '.auth/admin-api.json');

const UNAUTH_OPTS = {
  baseURL: BASE_URL,
  extraHTTPHeaders: { Origin: BASE_URL },
  storageState: { cookies: [], origins: [] },
};

/**
 * Covers the better-auth admin plugin endpoints under `/api/auth/admin/*`.
 * These endpoints drive the Users modal in the UI. Every mutation must be
 * admin-only; regular users calling them must get 401 / 403.
 */
test.describe('Admin user management API', () => {
  test('admin lists users', async ({ request }) => {
    // list-users is a GET with optional query parameters (limit, offset, etc.)
    const res = await request.get(`${BASE_URL}/api/auth/admin/list-users?limit=200`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    // The response shape is `{ users: [...], total: number }` or a flat array.
    const users = body?.users ?? body;
    expect(Array.isArray(users)).toBe(true);
    expect(users.length).toBeGreaterThan(0);
    const adminEmails = users.map((u: any) => u?.email).filter(Boolean);
    expect(adminEmails).toContain('admin@agentor.test');
  });

  test('regular user cannot list users', async () => {
    const user = await createTestUser('Admin List Denied');
    try {
      const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
      try {
        const api = new ApiClient(ctx);
        await api.signInEmail(user.email, user.password);
        const res = await ctx.get(`${BASE_URL}/api/auth/admin/list-users`);
        expect(res.status()).toBeGreaterThanOrEqual(400);
        expect(res.status()).toBeLessThan(500);
      } finally {
        await ctx.dispose();
      }
    } finally {
      await deleteTestUser(user.id);
    }
  });

  test('admin creates user with password', async ({ request }) => {
    const email = `created-${Date.now()}@test.example`;
    const res = await request.post(`${BASE_URL}/api/auth/admin/create-user`, {
      data: {
        email,
        password: 'created-user-password-12345',
        name: 'Created User',
        role: 'user',
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const userId = body?.user?.id ?? body?.id;
    expect(userId).toBeTruthy();

    try {
      // The new user can sign in
      const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
      try {
        const api = new ApiClient(ctx);
        const signIn = await api.signInEmail(email, 'created-user-password-12345');
        expect(signIn.status).toBe(200);
      } finally {
        await ctx.dispose();
      }
    } finally {
      await deleteTestUser(userId);
    }
  });

  test('admin creates user without password (passkey-only flow)', async ({ request }) => {
    const email = `passwordless-${Date.now()}@test.example`;
    const res = await request.post(`${BASE_URL}/api/auth/admin/create-user`, {
      data: { email, name: 'Passwordless User', role: 'user' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const userId = body?.user?.id ?? body?.id;
    expect(userId).toBeTruthy();

    try {
      // Without a password, the user cannot sign in via /sign-in/email.
      const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
      try {
        const api = new ApiClient(ctx);
        const signIn = await api.signInEmail(email, 'anything-at-all');
        expect(signIn.status).not.toBe(200);
      } finally {
        await ctx.dispose();
      }
    } finally {
      await deleteTestUser(userId);
    }
  });

  test('admin promotes and demotes a user', async ({ request }) => {
    const user = await createTestUser('Role Cycler');
    try {
      // Promote
      const promote = await request.post(`${BASE_URL}/api/auth/admin/set-role`, {
        data: { userId: user.id, role: 'admin' },
      });
      expect(promote.status()).toBe(200);

      // Verify the promoted user can hit an admin-only endpoint
      const promotedCtx = await playwrightRequest.newContext(UNAUTH_OPTS);
      try {
        const api = new ApiClient(promotedCtx);
        await api.signInEmail(user.email, user.password);
        const settings = await promotedCtx.get('/api/settings');
        expect(settings.status()).toBe(200);
      } finally {
        await promotedCtx.dispose();
      }

      // Demote
      const demote = await request.post(`${BASE_URL}/api/auth/admin/set-role`, {
        data: { userId: user.id, role: 'user' },
      });
      expect(demote.status()).toBe(200);

      // Verify settings now 403 for the demoted user
      const demotedCtx = await playwrightRequest.newContext(UNAUTH_OPTS);
      try {
        const api = new ApiClient(demotedCtx);
        await api.signInEmail(user.email, user.password);
        const settings = await demotedCtx.get('/api/settings');
        expect(settings.status()).toBe(403);
      } finally {
        await demotedCtx.dispose();
      }
    } finally {
      await deleteTestUser(user.id);
    }
  });

  test('admin removes a user', async ({ request }) => {
    const user = await createTestUser('Removable');
    // Call remove-user directly so we can verify the result inline
    const res = await request.post(`${BASE_URL}/api/auth/admin/remove-user`, {
      data: { userId: user.id },
    });
    expect(res.status()).toBe(200);

    // Confirm the user is gone by trying to sign in
    const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
    try {
      const api = new ApiClient(ctx);
      const signIn = await api.signInEmail(user.email, user.password);
      expect(signIn.status).not.toBe(200);
    } finally {
      await ctx.dispose();
    }
  });

  test('admin sets a user password and the user can sign in with it', async ({ request }) => {
    const user = await createTestUser('Password Reset');
    try {
      const newPassword = 'admin-set-password-67890';
      const res = await request.post(`${BASE_URL}/api/auth/admin/set-user-password`, {
        data: { userId: user.id, newPassword },
      });
      expect(res.status()).toBe(200);

      // Old password no longer works
      const oldCtx = await playwrightRequest.newContext(UNAUTH_OPTS);
      try {
        const api = new ApiClient(oldCtx);
        const signIn = await api.signInEmail(user.email, user.password);
        expect(signIn.status).not.toBe(200);
      } finally {
        await oldCtx.dispose();
      }

      // New password works
      const newCtx = await playwrightRequest.newContext(UNAUTH_OPTS);
      try {
        const api = new ApiClient(newCtx);
        const signIn = await api.signInEmail(user.email, newPassword);
        expect(signIn.status).toBe(200);
      } finally {
        await newCtx.dispose();
      }
    } finally {
      await deleteTestUser(user.id);
    }
  });

  test('regular user cannot create other users', async () => {
    const user = await createTestUser('Create Denied');
    try {
      const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
      try {
        const api = new ApiClient(ctx);
        await api.signInEmail(user.email, user.password);
        const res = await ctx.post(`${BASE_URL}/api/auth/admin/create-user`, {
          data: {
            email: 'should-not-exist@test.example',
            password: 'password12345',
            name: 'X',
            role: 'user',
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

  test('regular user cannot set another user password', async () => {
    const user = await createTestUser('Reset Denied');
    const victim = await createTestUser('Reset Victim');
    try {
      const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
      try {
        const api = new ApiClient(ctx);
        await api.signInEmail(user.email, user.password);
        const res = await ctx.post(`${BASE_URL}/api/auth/admin/set-user-password`, {
          data: { userId: victim.id, newPassword: 'hijacked-12345' },
        });
        expect(res.status()).toBeGreaterThanOrEqual(400);

        // Victim's original password still works
        const victimCtx = await playwrightRequest.newContext(UNAUTH_OPTS);
        try {
          const victimApi = new ApiClient(victimCtx);
          const signIn = await victimApi.signInEmail(victim.email, victim.password);
          expect(signIn.status).toBe(200);
        } finally {
          await victimCtx.dispose();
        }
      } finally {
        await ctx.dispose();
      }
    } finally {
      await deleteTestUser(user.id);
      await deleteTestUser(victim.id);
    }
  });

  test('creating user with duplicate email is rejected', async ({ request }) => {
    const user = await createTestUser('Original');
    try {
      const res = await request.post(`${BASE_URL}/api/auth/admin/create-user`, {
        data: {
          email: user.email,
          password: 'duplicate-12345',
          name: 'Duplicate',
          role: 'user',
        },
      });
      expect(res.status()).toBeGreaterThanOrEqual(400);
    } finally {
      await deleteTestUser(user.id);
    }
  });
});
