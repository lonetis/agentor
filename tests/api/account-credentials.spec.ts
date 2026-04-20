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

async function createUserAndSignIn(tag: string) {
  const email = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.example`;
  const password = `${tag}-password-${Date.now()}`;
  let id = '';
  const adminCtx = await playwrightRequest.newContext({ ...UNAUTH_OPTS, storageState: ADMIN_STORAGE });
  try {
    const create = await adminCtx.post('/api/auth/admin/create-user', {
      data: { email, password, name: tag, role: 'user' },
    });
    if (!create.ok()) throw new Error(`Failed to create user: ${create.status()}`);
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

test.describe('Account agent credentials (per-user) API', () => {
  test('GET /api/account/agent-credentials requires authentication', async () => {
    const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
    try {
      const api = new ApiClient(ctx);
      const { status } = await api.listAccountAgentCredentials();
      expect(status).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test('returns 3 entries (claude, codex, gemini), all not configured for a fresh user', async () => {
    const u = await createUserAndSignIn('cred-fresh');
    try {
      const { status, body } = await u.api.listAccountAgentCredentials();
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(3);
      const ids = body.map((c: { agentId: string }) => c.agentId).sort();
      expect(ids).toEqual(['claude', 'codex', 'gemini']);
      for (const c of body) {
        expect(typeof c.fileName).toBe('string');
        expect(c.fileName.length).toBeGreaterThan(0);
        expect(c.configured).toBe(false);
      }
    } finally {
      await cleanupUser(u);
    }
  });

  test('DELETE on a fresh credential is idempotent (returns ok)', async () => {
    const u = await createUserAndSignIn('cred-reset');
    try {
      const { status, body } = await u.api.resetAccountAgentCredential('claude');
      expect(status).toBe(200);
      expect(body.ok).toBe(true);

      // Listing still shows it as not configured.
      const list = await u.api.listAccountAgentCredentials();
      const claude = list.body.find((c: { agentId: string }) => c.agentId === 'claude');
      expect(claude.configured).toBe(false);
    } finally {
      await cleanupUser(u);
    }
  });

  test('DELETE rejects unknown agent id', async () => {
    const u = await createUserAndSignIn('cred-unknown');
    try {
      const { status } = await u.api.resetAccountAgentCredential('not-a-real-agent');
      expect(status).toBe(400);
    } finally {
      await cleanupUser(u);
    }
  });

  test('different users see independent credential listings', async () => {
    const a = await createUserAndSignIn('cred-iso-a');
    const b = await createUserAndSignIn('cred-iso-b');
    try {
      const aList = await a.api.listAccountAgentCredentials();
      const bList = await b.api.listAccountAgentCredentials();
      // Both lists have the same shape, both unconfigured for fresh users.
      expect(aList.body.length).toBe(3);
      expect(bList.body.length).toBe(3);
      for (const c of aList.body) expect(c.configured).toBe(false);
      for (const c of bList.body) expect(c.configured).toBe(false);
    } finally {
      await cleanupUser(a);
      await cleanupUser(b);
    }
  });
});
