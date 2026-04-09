import { test, expect, request as playwrightRequest } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN_STORAGE = resolve(__dirname, '..', '.auth/admin-api.json');

const CONTEXT_OPTS = {
  baseURL: BASE_URL,
  extraHTTPHeaders: { Origin: BASE_URL },
  storageState: { cookies: [], origins: [] },
};

/**
 * Creates a regular user via the admin API and returns a pre-authenticated
 * request context for that user. Caller must dispose the context.
 */
async function createUserAndSignIn(email: string, password: string, name: string) {
  const adminCtx = await playwrightRequest.newContext({
    ...CONTEXT_OPTS,
    storageState: ADMIN_STORAGE,
  });
  try {
    const createRes = await adminCtx.post('/api/auth/admin/create-user', {
      data: { email, password, name, role: 'user' },
    });
    if (!createRes.ok()) {
      throw new Error(`Failed to create user: ${createRes.status()} ${await createRes.text()}`);
    }
  } finally {
    await adminCtx.dispose();
  }

  const ctx = await playwrightRequest.newContext(CONTEXT_OPTS);
  const api = new ApiClient(ctx);
  const signIn = await api.signInEmail(email, password);
  if (signIn.status !== 200) {
    await ctx.dispose();
    throw new Error(`Failed to sign in ${email}: ${signIn.status}`);
  }
  return ctx;
}

test.describe('Account self-service', () => {
  test('user can change their own password', async () => {
    const email = `pwchange-${Date.now()}@test.example`;
    const oldPassword = 'old-password-12345';
    const newPassword = 'new-password-67890';

    let ctx;
    try {
      ctx = await createUserAndSignIn(email, oldPassword, 'Password Change Test');
    } catch (err) {
      test.skip(true, `Cannot create regular user: ${(err as Error).message}`);
      return;
    }

    try {
      // Change the password
      const changeRes = await ctx.post('/api/auth/change-password', {
        data: { currentPassword: oldPassword, newPassword, revokeOtherSessions: false },
      });
      expect(changeRes.status()).toBe(200);

      // Signing in with the new password should work
      const freshCtx = await playwrightRequest.newContext(CONTEXT_OPTS);
      try {
        const api = new ApiClient(freshCtx);
        const signIn = await api.signInEmail(email, newPassword);
        expect(signIn.status).toBe(200);
      } finally {
        await freshCtx.dispose();
      }

      // The old password should fail
      const staleCtx = await playwrightRequest.newContext(CONTEXT_OPTS);
      try {
        const api = new ApiClient(staleCtx);
        const signIn = await api.signInEmail(email, oldPassword);
        expect(signIn.status).not.toBe(200);
      } finally {
        await staleCtx.dispose();
      }
    } finally {
      await ctx.dispose();
    }
  });

  test('change password rejects wrong current password', async () => {
    const email = `pwreject-${Date.now()}@test.example`;
    const password = 'correct-password-12345';

    let ctx;
    try {
      ctx = await createUserAndSignIn(email, password, 'Password Reject Test');
    } catch (err) {
      test.skip(true, `Cannot create regular user: ${(err as Error).message}`);
      return;
    }

    try {
      const res = await ctx.post('/api/auth/change-password', {
        data: {
          currentPassword: 'wrong-current-password',
          newPassword: 'new-password-67890',
          revokeOtherSessions: false,
        },
      });
      expect(res.status()).toBeGreaterThanOrEqual(400);
    } finally {
      await ctx.dispose();
    }
  });

  test('user can change their own email', async () => {
    const oldEmail = `email-old-${Date.now()}@test.example`;
    const newEmail = `email-new-${Date.now()}@test.example`;
    const password = 'email-change-password-12345';

    let ctx;
    try {
      ctx = await createUserAndSignIn(oldEmail, password, 'Email Change Test');
    } catch (err) {
      test.skip(true, `Cannot create regular user: ${(err as Error).message}`);
      return;
    }

    try {
      const changeRes = await ctx.post('/api/auth/change-email', {
        data: { newEmail },
      });
      expect(changeRes.status()).toBe(200);

      // Sign in with the new email
      const freshCtx = await playwrightRequest.newContext(CONTEXT_OPTS);
      try {
        const api = new ApiClient(freshCtx);
        const signIn = await api.signInEmail(newEmail, password);
        expect(signIn.status).toBe(200);
      } finally {
        await freshCtx.dispose();
      }
    } finally {
      await ctx.dispose();
    }
  });

  test('user can update their own name', async () => {
    const email = `namechange-${Date.now()}@test.example`;
    const password = 'name-change-password-12345';

    let ctx;
    try {
      ctx = await createUserAndSignIn(email, password, 'Original Name');
    } catch (err) {
      test.skip(true, `Cannot create regular user: ${(err as Error).message}`);
      return;
    }

    try {
      const updateRes = await ctx.post('/api/auth/update-user', {
        data: { name: 'Updated Name' },
      });
      expect(updateRes.status()).toBe(200);

      // Verify the session reflects the new name
      const api = new ApiClient(ctx);
      const session = await api.getAuthSession();
      expect(session.body?.user?.name).toBe('Updated Name');
    } finally {
      await ctx.dispose();
    }
  });

  test('admin can reset another user\'s password', async () => {
    const email = `adminreset-${Date.now()}@test.example`;
    const originalPassword = 'original-password-12345';
    const adminSetPassword = 'admin-set-password-67890';

    let userCtx;
    try {
      userCtx = await createUserAndSignIn(email, originalPassword, 'Admin Reset Test');
    } catch (err) {
      test.skip(true, `Cannot create regular user: ${(err as Error).message}`);
      return;
    }
    const userId = (await new ApiClient(userCtx).getAuthSession()).body?.user?.id;
    await userCtx.dispose();

    // Admin sets a new password for the user
    const adminCtx = await playwrightRequest.newContext({
      ...CONTEXT_OPTS,
      storageState: ADMIN_STORAGE,
    });
    try {
      const res = await adminCtx.post('/api/auth/admin/set-user-password', {
        data: { userId, newPassword: adminSetPassword },
      });
      expect(res.status()).toBe(200);
    } finally {
      await adminCtx.dispose();
    }

    // User signs in with the new password
    const freshCtx = await playwrightRequest.newContext(CONTEXT_OPTS);
    try {
      const api = new ApiClient(freshCtx);
      const signIn = await api.signInEmail(email, adminSetPassword);
      expect(signIn.status).toBe(200);
    } finally {
      await freshCtx.dispose();
    }
  });
});
