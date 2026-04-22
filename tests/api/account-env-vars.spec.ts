import { test, expect, request as playwrightRequest } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
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

interface UserCtx {
  ctx: import('@playwright/test').APIRequestContext;
  api: ApiClient;
  email: string;
  password: string;
  id: string;
}

async function createUserAndSignIn(role: 'admin' | 'user', tag: string): Promise<UserCtx> {
  const email = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.example`;
  const password = `${tag}-password-${Date.now()}`;

  let id = '';
  const adminCtx = await playwrightRequest.newContext({ ...UNAUTH_OPTS, storageState: ADMIN_STORAGE });
  try {
    const create = await adminCtx.post('/api/auth/admin/create-user', {
      data: { email, password, name: `${tag} ${role}`, role },
    });
    if (!create.ok()) {
      throw new Error(`Failed to create user: ${create.status()} ${await create.text()}`);
    }
    const body = await create.json().catch(() => ({}));
    id = body?.user?.id ?? body?.id ?? '';
  } finally {
    await adminCtx.dispose();
  }

  const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
  const api = new ApiClient(ctx);
  const signIn = await api.signInEmail(email, password);
  if (signIn.status !== 200) {
    await ctx.dispose();
    throw new Error(`Sign-in failed for ${email}: ${signIn.status}`);
  }
  return { ctx, api, email, password, id };
}

/** Best-effort cleanup — deletes the test user via admin API. Keeps the DB
 * clean across a long parallel run so admin.listUsers stays snappy. */
async function cleanupUser(u: { ctx: import('@playwright/test').APIRequestContext; id: string }): Promise<void> {
  await u.ctx.dispose().catch(() => {});
  if (!u.id) return;
  const adminCtx = await playwrightRequest.newContext({ ...UNAUTH_OPTS, storageState: ADMIN_STORAGE });
  try {
    await adminCtx.post('/api/auth/admin/remove-user', { data: { userId: u.id } });
  } catch {
    // ignore
  } finally {
    await adminCtx.dispose();
  }
}

test.describe('Account env vars (per-user) API', () => {
  test('GET /api/account/env-vars requires authentication', async () => {
    const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
    try {
      const api = new ApiClient(ctx);
      const { status } = await api.getAccountEnvVars();
      expect(status).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test('PUT /api/account/env-vars requires authentication', async () => {
    const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
    try {
      const api = new ApiClient(ctx);
      const { status } = await api.putAccountEnvVars({ githubToken: 'x' });
      expect(status).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test('a fresh user starts with all env vars empty', async () => {
    const u = await createUserAndSignIn('user', 'fresh');
    try {
      const { status, body } = await u.api.getAccountEnvVars();
      expect(status).toBe(200);
      expect(body.githubToken).toBe('');
      expect(body.anthropicApiKey).toBe('');
      expect(body.claudeCodeOauthToken).toBe('');
      expect(body.openaiApiKey).toBe('');
      expect(body.geminiApiKey).toBe('');
      expect(body.sshPublicKey).toBe('');
      expect(body.customEnvVars).toEqual([]);
    } finally {
      await cleanupUser(u);
    }
  });

  test('sshPublicKey round-trips via PUT + GET', async () => {
    const u = await createUserAndSignIn('user', 'ssh-key');
    try {
      const key = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyForTests example@test';
      const put = await u.api.putAccountEnvVars({ sshPublicKey: key });
      expect(put.status).toBe(200);
      const { body } = await u.api.getAccountEnvVars();
      expect(body.sshPublicKey).toBe(key);
    } finally {
      await cleanupUser(u);
    }
  });

  test('sshPublicKey partial update keeps other fields', async () => {
    const u = await createUserAndSignIn('user', 'ssh-key-partial');
    try {
      await u.api.putAccountEnvVars({ githubToken: 'gh-keep', sshPublicKey: 'ssh-rsa AAAAB3 test@h' });
      await u.api.putAccountEnvVars({ sshPublicKey: 'ssh-ed25519 AAAAC3 test@h' });
      const { body } = await u.api.getAccountEnvVars();
      expect(body.githubToken).toBe('gh-keep');
      expect(body.sshPublicKey).toBe('ssh-ed25519 AAAAC3 test@h');
    } finally {
      await cleanupUser(u);
    }
  });

  test('sshPublicKey is isolated per user', async () => {
    const a = await createUserAndSignIn('user', 'ssh-iso-a');
    const b = await createUserAndSignIn('user', 'ssh-iso-b');
    try {
      await a.api.putAccountEnvVars({ sshPublicKey: 'ssh-ed25519 AAAA-A' });
      await b.api.putAccountEnvVars({ sshPublicKey: 'ssh-ed25519 AAAA-B' });
      const aGet = await a.api.getAccountEnvVars();
      const bGet = await b.api.getAccountEnvVars();
      expect(aGet.body.sshPublicKey).toBe('ssh-ed25519 AAAA-A');
      expect(bGet.body.sshPublicKey).toBe('ssh-ed25519 AAAA-B');
    } finally {
      await cleanupUser(a);
      await cleanupUser(b);
    }
  });

  test('PUT upserts well-known fields and GET reflects', async () => {
    const u = await createUserAndSignIn('user', 'upsert');
    try {
      const put = await u.api.putAccountEnvVars({
        githubToken: 'gh-aaa',
        anthropicApiKey: 'sk-ant-bbb',
        openaiApiKey: 'sk-ccc',
      });
      expect(put.status).toBe(200);

      const get = await u.api.getAccountEnvVars();
      expect(get.status).toBe(200);
      expect(get.body.githubToken).toBe('gh-aaa');
      expect(get.body.anthropicApiKey).toBe('sk-ant-bbb');
      expect(get.body.openaiApiKey).toBe('sk-ccc');
      // Unset fields stay empty
      expect(get.body.geminiApiKey).toBe('');
      expect(get.body.claudeCodeOauthToken).toBe('');
    } finally {
      await cleanupUser(u);
    }
  });

  test('partial PUT only changes the supplied fields', async () => {
    const u = await createUserAndSignIn('user', 'partial');
    try {
      await u.api.putAccountEnvVars({ githubToken: 'gh-1', anthropicApiKey: 'sk-1' });
      // Only update one field
      await u.api.putAccountEnvVars({ githubToken: 'gh-2' });
      const { body } = await u.api.getAccountEnvVars();
      expect(body.githubToken).toBe('gh-2');
      expect(body.anthropicApiKey).toBe('sk-1');
    } finally {
      await cleanupUser(u);
    }
  });

  test('customEnvVars round-trip', async () => {
    const u = await createUserAndSignIn('user', 'custom');
    try {
      const put = await u.api.putAccountEnvVars({
        customEnvVars: [
          { key: 'FOO', value: 'bar' },
          { key: 'API_BASE', value: 'https://example.test' },
        ],
      });
      expect(put.status).toBe(200);

      const { body } = await u.api.getAccountEnvVars();
      expect(body.customEnvVars).toHaveLength(2);
      expect(body.customEnvVars).toContainEqual({ key: 'FOO', value: 'bar' });
      expect(body.customEnvVars).toContainEqual({ key: 'API_BASE', value: 'https://example.test' });
    } finally {
      await cleanupUser(u);
    }
  });

  test('rejects invalid customEnvVars key (lowercase)', async () => {
    const u = await createUserAndSignIn('user', 'invalid-lc');
    try {
      const { status } = await u.api.putAccountEnvVars({
        customEnvVars: [{ key: 'badKey', value: 'x' }],
      });
      expect(status).toBe(400);
    } finally {
      await cleanupUser(u);
    }
  });

  test('rejects invalid customEnvVars key (starts with digit)', async () => {
    const u = await createUserAndSignIn('user', 'invalid-digit');
    try {
      const { status } = await u.api.putAccountEnvVars({
        customEnvVars: [{ key: '1FOO', value: 'x' }],
      });
      expect(status).toBe(400);
    } finally {
      await cleanupUser(u);
    }
  });

  test('rejects reserved env var name', async () => {
    const u = await createUserAndSignIn('user', 'invalid-reserved');
    try {
      const { status } = await u.api.putAccountEnvVars({
        customEnvVars: [{ key: 'WORKER', value: 'x' }],
      });
      expect(status).toBe(400);
    } finally {
      await cleanupUser(u);
    }
  });

  test('rejects duplicate custom env var keys', async () => {
    const u = await createUserAndSignIn('user', 'invalid-dup');
    try {
      const { status } = await u.api.putAccountEnvVars({
        customEnvVars: [
          { key: 'FOO', value: 'a' },
          { key: 'FOO', value: 'b' },
        ],
      });
      expect(status).toBe(400);
    } finally {
      await cleanupUser(u);
    }
  });

  test("user A's env vars are isolated from user B's", async () => {
    const a = await createUserAndSignIn('user', 'iso-a');
    const b = await createUserAndSignIn('user', 'iso-b');
    try {
      await a.api.putAccountEnvVars({ githubToken: 'gh-A', anthropicApiKey: 'sk-A' });
      await b.api.putAccountEnvVars({ githubToken: 'gh-B' });

      const aGet = await a.api.getAccountEnvVars();
      const bGet = await b.api.getAccountEnvVars();
      expect(aGet.body.githubToken).toBe('gh-A');
      expect(aGet.body.anthropicApiKey).toBe('sk-A');
      expect(bGet.body.githubToken).toBe('gh-B');
      expect(bGet.body.anthropicApiKey).toBe('');
    } finally {
      await cleanupUser(a);
      await cleanupUser(b);
    }
  });

  test("admin cannot view another user's env vars", async () => {
    // Even admins do not have a way to read another user's env vars — the
    // endpoint is scoped to event.context.auth.user.id with no userId query.
    const u = await createUserAndSignIn('user', 'admin-view');
    try {
      await u.api.putAccountEnvVars({ githubToken: 'gh-private' });

      const adminCtx = await playwrightRequest.newContext({
        ...UNAUTH_OPTS,
        storageState: ADMIN_STORAGE,
      });
      try {
        const adminApi = new ApiClient(adminCtx);
        const { body } = await adminApi.getAccountEnvVars();
        // Admin sees ONLY their own env vars (which are unset, since the
        // tests have not configured the admin user).
        expect(body.githubToken).not.toBe('gh-private');
      } finally {
        await adminCtx.dispose();
      }
    } finally {
      await cleanupUser(u);
    }
  });
});
