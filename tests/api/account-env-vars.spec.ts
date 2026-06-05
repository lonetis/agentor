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

/** Find an env var's value by key in the `{ envVars: [{key,value}] }` payload. */
function envVal(body: { envVars?: { key: string; value: string }[] }, key: string): string | undefined {
  return body.envVars?.find((e) => e.key === key)?.value;
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
      const { status } = await api.putAccountEnvVars({ envVars: [{ key: 'GITHUB_TOKEN', value: 'x' }] });
      expect(status).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test('a fresh user starts with an empty envVars list (no hardcoded fields, no sshPublicKey)', async () => {
    const u = await createUserAndSignIn('user', 'fresh');
    try {
      const { status, body } = await u.api.getAccountEnvVars();
      expect(status).toBe(200);
      expect(body.envVars).toEqual([]);
      // Carries the owner userId like every user-scoped resource (also persisted in the file).
      expect(body.userId).toBe(u.id);
      // The old hardcoded fields and sshPublicKey are gone from this endpoint.
      expect(body.githubToken).toBeUndefined();
      expect(body.anthropicApiKey).toBeUndefined();
      expect(body.sshPublicKey).toBeUndefined();
      expect(body.customEnvVars).toBeUndefined();
    } finally {
      await cleanupUser(u);
    }
  });

  test('predefined and custom env vars are stored uniformly, keyed by env var name', async () => {
    const u = await createUserAndSignIn('user', 'uniform');
    try {
      const put = await u.api.putAccountEnvVars({
        envVars: [
          { key: 'GITHUB_TOKEN', value: 'gh-aaa' },
          { key: 'ANTHROPIC_API_KEY', value: 'sk-ant-bbb' },
          { key: 'MY_CUSTOM', value: 'custom-val' },
        ],
      });
      expect(put.status).toBe(200);

      const { status, body } = await u.api.getAccountEnvVars();
      expect(status).toBe(200);
      expect(envVal(body, 'GITHUB_TOKEN')).toBe('gh-aaa');
      expect(envVal(body, 'ANTHROPIC_API_KEY')).toBe('sk-ant-bbb');
      expect(envVal(body, 'MY_CUSTOM')).toBe('custom-val');
      // Unset predefined keys simply do not appear in the list.
      expect(envVal(body, 'GEMINI_API_KEY')).toBeUndefined();
    } finally {
      await cleanupUser(u);
    }
  });

  test('PUT replaces the whole envVars list', async () => {
    const u = await createUserAndSignIn('user', 'replace');
    try {
      await u.api.putAccountEnvVars({ envVars: [{ key: 'GITHUB_TOKEN', value: 'gh-1' }, { key: 'FOO', value: 'a' }] });
      // A second PUT with a different list replaces the first entirely.
      await u.api.putAccountEnvVars({ envVars: [{ key: 'GITHUB_TOKEN', value: 'gh-2' }] });
      const { body } = await u.api.getAccountEnvVars();
      expect(body.envVars).toHaveLength(1);
      expect(envVal(body, 'GITHUB_TOKEN')).toBe('gh-2');
      expect(envVal(body, 'FOO')).toBeUndefined();
    } finally {
      await cleanupUser(u);
    }
  });

  test('rejects an invalid env var name (lowercase)', async () => {
    const u = await createUserAndSignIn('user', 'invalid-lc');
    try {
      const { status } = await u.api.putAccountEnvVars({ envVars: [{ key: 'badKey', value: 'x' }] });
      expect(status).toBe(400);
    } finally {
      await cleanupUser(u);
    }
  });

  test('rejects an invalid env var name (starts with digit)', async () => {
    const u = await createUserAndSignIn('user', 'invalid-digit');
    try {
      const { status } = await u.api.putAccountEnvVars({ envVars: [{ key: '1FOO', value: 'x' }] });
      expect(status).toBe(400);
    } finally {
      await cleanupUser(u);
    }
  });

  test('rejects a reserved env var name', async () => {
    const u = await createUserAndSignIn('user', 'invalid-reserved');
    try {
      const { status } = await u.api.putAccountEnvVars({ envVars: [{ key: 'WORKER', value: 'x' }] });
      expect(status).toBe(400);
    } finally {
      await cleanupUser(u);
    }
  });

  test('rejects duplicate env var keys', async () => {
    const u = await createUserAndSignIn('user', 'invalid-dup');
    try {
      const { status } = await u.api.putAccountEnvVars({
        envVars: [{ key: 'FOO', value: 'a' }, { key: 'FOO', value: 'b' }],
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
      await a.api.putAccountEnvVars({ envVars: [{ key: 'GITHUB_TOKEN', value: 'gh-A' }, { key: 'ANTHROPIC_API_KEY', value: 'sk-A' }] });
      await b.api.putAccountEnvVars({ envVars: [{ key: 'GITHUB_TOKEN', value: 'gh-B' }] });

      const aGet = await a.api.getAccountEnvVars();
      const bGet = await b.api.getAccountEnvVars();
      expect(envVal(aGet.body, 'GITHUB_TOKEN')).toBe('gh-A');
      expect(envVal(aGet.body, 'ANTHROPIC_API_KEY')).toBe('sk-A');
      expect(envVal(bGet.body, 'GITHUB_TOKEN')).toBe('gh-B');
      expect(envVal(bGet.body, 'ANTHROPIC_API_KEY')).toBeUndefined();
    } finally {
      await cleanupUser(a);
      await cleanupUser(b);
    }
  });

  test("admin cannot view another user's env vars", async () => {
    const u = await createUserAndSignIn('user', 'admin-view');
    try {
      await u.api.putAccountEnvVars({ envVars: [{ key: 'GITHUB_TOKEN', value: 'gh-private' }] });

      const adminCtx = await playwrightRequest.newContext({ ...UNAUTH_OPTS, storageState: ADMIN_STORAGE });
      try {
        const adminApi = new ApiClient(adminCtx);
        const { body } = await adminApi.getAccountEnvVars();
        expect(envVal(body, 'GITHUB_TOKEN')).not.toBe('gh-private');
      } finally {
        await adminCtx.dispose();
      }
    } finally {
      await cleanupUser(u);
    }
  });
});

test.describe('Account SSH key (per-user) API', () => {
  test('GET /api/account/ssh-key requires authentication', async () => {
    const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
    try {
      const { status } = await new ApiClient(ctx).getAccountSshKey();
      expect(status).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test('PUT /api/account/ssh-key requires authentication', async () => {
    const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
    try {
      const { status } = await new ApiClient(ctx).putAccountSshKey({ sshPublicKey: 'ssh-ed25519 AAAA x@h' });
      expect(status).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test('a fresh user has an empty SSH key', async () => {
    const u = await createUserAndSignIn('user', 'ssh-fresh');
    try {
      const { status, body } = await u.api.getAccountSshKey();
      expect(status).toBe(200);
      expect(body.sshPublicKey).toBe('');
    } finally {
      await cleanupUser(u);
    }
  });

  test('SSH key round-trips via PUT + GET', async () => {
    const u = await createUserAndSignIn('user', 'ssh-rt');
    try {
      const key = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyForTests example@test';
      const put = await u.api.putAccountSshKey({ sshPublicKey: key });
      expect(put.status).toBe(200);
      expect(put.body.sshPublicKey).toBe(key);
      const { body } = await u.api.getAccountSshKey();
      expect(body.sshPublicKey).toBe(key);
    } finally {
      await cleanupUser(u);
    }
  });

  test('SSH key is NOT stored in env-vars.json', async () => {
    const u = await createUserAndSignIn('user', 'ssh-notenv');
    try {
      await u.api.putAccountSshKey({ sshPublicKey: 'ssh-ed25519 AAAA-only-in-file x@h' });
      // It must not leak into the env-vars list under any key.
      const { body } = await u.api.getAccountEnvVars();
      expect(body.sshPublicKey).toBeUndefined();
      expect((body.envVars ?? []).some((e: { value: string }) => e.value.includes('only-in-file'))).toBe(false);
    } finally {
      await cleanupUser(u);
    }
  });

  test('SSH key is isolated per user', async () => {
    const a = await createUserAndSignIn('user', 'ssh-iso-a');
    const b = await createUserAndSignIn('user', 'ssh-iso-b');
    try {
      await a.api.putAccountSshKey({ sshPublicKey: 'ssh-ed25519 AAAA-A x@h' });
      await b.api.putAccountSshKey({ sshPublicKey: 'ssh-ed25519 AAAA-B x@h' });
      expect((await a.api.getAccountSshKey()).body.sshPublicKey).toBe('ssh-ed25519 AAAA-A x@h');
      expect((await b.api.getAccountSshKey()).body.sshPublicKey).toBe('ssh-ed25519 AAAA-B x@h');
    } finally {
      await cleanupUser(a);
      await cleanupUser(b);
    }
  });
});
