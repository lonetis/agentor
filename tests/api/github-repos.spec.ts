import { test, expect, request as playwrightRequest } from '@playwright/test';
import { createTestUser, deleteTestUser } from '../helpers/test-users';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const FRESH_OPTS = {
  baseURL: BASE_URL,
  extraHTTPHeaders: { Origin: BASE_URL },
  storageState: { cookies: [], origins: [] },
};

test.describe('GitHub repos endpoint', () => {
  test('requires auth', async () => {
    const ctx = await playwrightRequest.newContext(FRESH_OPTS);
    try {
      const res = await ctx.get('/api/github/repos');
      expect(res.status()).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test('no token → tokenConfigured false with an empty repo list', async () => {
    const user = await createTestUser('GH No Token');
    const ctx = await playwrightRequest.newContext(FRESH_OPTS);
    try {
      await ctx.post('/api/auth/sign-in/email', {
        headers: { Origin: BASE_URL, 'Content-Type': 'application/json' },
        data: { email: user.email, password: user.password },
      });
      const res = await ctx.get('/api/github/repos');
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.tokenConfigured).toBe(false);
      expect(Array.isArray(body.repos)).toBe(true);
      expect(body.repos.length).toBe(0);
      expect(typeof body.username).toBe('string');
      expect(Array.isArray(body.orgs)).toBe(true);
    } finally {
      await ctx.dispose();
      await deleteTestUser(user.id);
    }
  });

  test('bad token → tokenConfigured true with a surfaced error (no longer masquerades as no-token)', async () => {
    test.setTimeout(60_000);
    const user = await createTestUser('GH Bad Token');
    const ctx = await playwrightRequest.newContext(FRESH_OPTS);
    try {
      await ctx.post('/api/auth/sign-in/email', {
        headers: { Origin: BASE_URL, 'Content-Type': 'application/json' },
        data: { email: user.email, password: user.password },
      });
      const put = await ctx.put('/api/account/env-vars', {
        headers: { Origin: BASE_URL, 'Content-Type': 'application/json' },
        data: { envVars: [{ key: 'GITHUB_TOKEN', value: 'ghp_bogus_invalid_token_for_test' }] },
      });
      expect(put.status()).toBe(200);

      const res = await ctx.get('/api/github/repos');
      expect(res.status()).toBe(200);
      const body = await res.json();
      // A token IS configured — the endpoint must report it as such (the old bug
      // reported tokenConfigured:false on any failure, hiding the real cause).
      expect(body.tokenConfigured).toBe(true);
      // The failure (GitHub 401 / network) is surfaced rather than swallowed.
      expect(typeof body.error).toBe('string');
      expect(body.error.length).toBeGreaterThan(0);
      expect(Array.isArray(body.repos)).toBe(true);
      expect(body.repos.length).toBe(0);
    } finally {
      await ctx.dispose();
      await deleteTestUser(user.id);
    }
  });
});
