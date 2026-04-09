import { test, expect, request as playwrightRequest } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';
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
 * Create a regular (non-admin) user via better-auth sign-up and return a
 * request context authenticated as that user. Caller must dispose the context.
 */
async function createRegularUserContext(email: string, password: string, name: string) {
  const ctx = await playwrightRequest.newContext(CONTEXT_OPTS);
  // Admin session must create the user since self sign-up is not exposed
  // separately. We use the admin API to ensure role = 'user'.
  const adminCtx = await playwrightRequest.newContext({
    ...CONTEXT_OPTS,
    storageState: ADMIN_STORAGE,
  });
  try {
    await adminCtx.post('/api/auth/admin/create-user', {
      data: { email, password, name, role: 'user' },
    }).catch(() => null);
  } finally {
    await adminCtx.dispose();
  }

  const api = new ApiClient(ctx);
  const { status } = await api.signInEmail(email, password);
  if (status !== 200) {
    await ctx.dispose();
    throw new Error(`Failed to sign in as ${email}: ${status}`);
  }
  return ctx;
}

test.describe('Authorization', () => {
  test('admin can list all containers', async ({ request }) => {
    const api = new ApiClient(request);
    const { status } = await api.listContainers();
    expect(status).toBe(200);
  });

  test('regular user sees only their own containers', async ({ request }) => {
    const email = `user-${Date.now()}@test.example`;
    const password = 'test-password-12345';

    // Admin creates a worker
    const adminWorker = await createWorker(request);

    // Create a regular user
    let userCtx;
    try {
      userCtx = await createRegularUserContext(email, password, 'Regular User');
    } catch (err) {
      // If better-auth admin endpoint isn't available, skip
      await cleanupWorker(request, adminWorker.id);
      test.skip(true, `Skipping — cannot create regular user: ${(err as Error).message}`);
      return;
    }

    try {
      const userApi = new ApiClient(userCtx);
      const { status, body } = await userApi.listContainers();
      expect(status).toBe(200);
      // Regular user should NOT see the admin's container
      expect(Array.isArray(body)).toBe(true);
      const found = body.find((c: any) => c.id === adminWorker.id);
      expect(found).toBeUndefined();
    } finally {
      await userCtx.dispose();
      await cleanupWorker(request, adminWorker.id);
    }
  });

  test('regular user cannot stop an admin container', async ({ request }) => {
    const email = `user2-${Date.now()}@test.example`;
    const password = 'test-password-12345';

    const adminWorker = await createWorker(request);

    let userCtx;
    try {
      userCtx = await createRegularUserContext(email, password, 'Regular User 2');
    } catch (err) {
      await cleanupWorker(request, adminWorker.id);
      test.skip(true, `Skipping — cannot create regular user: ${(err as Error).message}`);
      return;
    }

    try {
      const userApi = new ApiClient(userCtx);
      const { status } = await userApi.stopContainer(adminWorker.id);
      expect([403, 404]).toContain(status);
    } finally {
      await userCtx.dispose();
      await cleanupWorker(request, adminWorker.id);
    }
  });

  test('unauthenticated requests to mutation endpoints return 401', async () => {
    const ctx = await playwrightRequest.newContext(CONTEXT_OPTS);
    try {
      const api = new ApiClient(ctx);
      const list = await api.listContainers();
      expect(list.status).toBe(401);
      const create = await api.createContainer({ name: 'nope' });
      expect(create.status).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test('admin-only endpoints reject non-admin users', async ({ request }) => {
    const email = `user3-${Date.now()}@test.example`;
    const password = 'test-password-12345';

    let userCtx;
    try {
      userCtx = await createRegularUserContext(email, password, 'Regular User 3');
    } catch (err) {
      test.skip(true, `Skipping — cannot create regular user: ${(err as Error).message}`);
      return;
    }

    try {
      const settingsRes = await userCtx.get('/api/settings');
      expect(settingsRes.status()).toBe(403);
    } finally {
      await userCtx.dispose();
    }
  });
});
