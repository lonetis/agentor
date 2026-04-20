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

test.describe('Usage API (per-user)', () => {
  test.describe('GET /api/usage', () => {
    test('returns 401 without a session', async () => {
      const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
      try {
        const api = new ApiClient(ctx);
        const { status } = await api.getUsageStatus();
        expect(status).toBe(401);
      } finally {
        await ctx.dispose();
      }
    });

    test('returns 200 with agents array for the authenticated user', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.getUsageStatus();
      expect(status).toBe(200);
      expect(Array.isArray(body.agents)).toBe(true);
    });
  });

  test.describe('POST /api/usage/refresh', () => {
    test('returns 401 without a session', async () => {
      const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
      try {
        const api = new ApiClient(ctx);
        const { status } = await api.refreshUsage();
        expect(status).toBe(401);
      } finally {
        await ctx.dispose();
      }
    });

    test('refresh populates all three agents for the caller', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.refreshUsage();
      expect(status).toBe(200);
      const ids = body.agents.map((a: { agentId: string }) => a.agentId);
      expect(ids).toContain('claude');
      expect(ids).toContain('codex');
      expect(ids).toContain('gemini');
    });

    test('refresh-then-get returns same agent list', async ({ request }) => {
      const api = new ApiClient(request);
      await api.refreshUsage();
      const { body } = await api.getUsageStatus();
      const ids = body.agents.map((a: { agentId: string }) => a.agentId).sort();
      expect(ids).toEqual(['claude', 'codex', 'gemini']);
    });

    test('agents have valid shape after refresh', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.refreshUsage();
      for (const agent of body.agents) {
        expect(typeof agent.agentId).toBe('string');
        expect(typeof agent.displayName).toBe('string');
        expect(['oauth', 'api-key', 'none']).toContain(agent.authType);
        expect(typeof agent.usageAvailable).toBe('boolean');
        expect(Array.isArray(agent.windows)).toBe(true);
        for (const w of agent.windows) {
          expect(typeof w.label).toBe('string');
          expect(typeof w.utilization).toBe('number');
          expect(w.resetsAt === null || typeof w.resetsAt === 'string').toBe(true);
        }
      }
    });
  });

  test.describe('Per-user isolation', () => {
    test("user B's usage status does not leak into user A's", async () => {
      const adminCtx = await playwrightRequest.newContext({
        ...UNAUTH_OPTS,
        storageState: ADMIN_STORAGE,
      });
      let createdUserId = '';
      try {
        const adminApi = new ApiClient(adminCtx);
        const userEmail = `usage-iso-${Date.now()}@test.example`;
        const userPassword = 'usage-iso-password-12345';

        const create = await adminCtx.post('/api/auth/admin/create-user', {
          data: { email: userEmail, password: userPassword, name: 'Usage Isolation', role: 'user' },
        });
        if (!create.ok()) {
          test.skip(true, `Cannot create user: ${create.status()}`);
          return;
        }
        const createBody = await create.json().catch(() => ({}));
        createdUserId = createBody?.user?.id ?? createBody?.id ?? '';

        const userCtx = await playwrightRequest.newContext(UNAUTH_OPTS);
        try {
          const userApi = new ApiClient(userCtx);
          const signIn = await userApi.signInEmail(userEmail, userPassword);
          expect(signIn.status).toBe(200);

          // User B sets a Claude OAuth token. The usage checker should track
          // B's claim independently of A's (admin's) state.
          await userApi.putAccountEnvVars({ claudeCodeOauthToken: 'fake-token-for-usage-isolation' });

          await userApi.refreshUsage();
          const userStatus = await userApi.getUsageStatus();
          const userClaude = userStatus.body.agents.find((a: { agentId: string }) => a.agentId === 'claude');
          // User B has the token set, so authType should be 'oauth' (even
          // though the upstream API call will fail with the fake token).
          expect(userClaude?.authType).toBe('oauth');

          await adminApi.refreshUsage();
          const adminStatus = await adminApi.getUsageStatus();
          const adminClaude = adminStatus.body.agents.find((a: { agentId: string }) => a.agentId === 'claude');
          // Admin never set the token, so they remain authType: 'none'.
          expect(adminClaude?.authType).toBe('none');
        } finally {
          await userCtx.dispose();
        }
        if (createdUserId) {
          await adminCtx.post('/api/auth/admin/remove-user', { data: { userId: createdUserId } }).catch(() => {});
        }
      } finally {
        await adminCtx.dispose();
      }
    });
  });
});
