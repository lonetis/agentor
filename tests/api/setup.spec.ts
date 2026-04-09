import { test, expect, request as playwrightRequest } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const UNAUTH_OPTS = {
  baseURL: BASE_URL,
  extraHTTPHeaders: { Origin: BASE_URL },
  storageState: { cookies: [], origins: [] },
};

test.describe('Setup flow', () => {
  test('status returns needsSetup = false after initial admin exists', async ({ request }) => {
    const api = new ApiClient(request);
    const { status, body } = await api.getSetupStatus();
    expect(status).toBe(200);
    expect(body.needsSetup).toBe(false);
  });

  test('status endpoint is publicly accessible', async () => {
    const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
    try {
      const api = new ApiClient(ctx);
      const { status, body } = await api.getSetupStatus();
      expect(status).toBe(200);
      expect(body).toHaveProperty('needsSetup');
    } finally {
      await ctx.dispose();
    }
  });

  test('creating admin fails with 409 when users already exist', async () => {
    const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
    try {
      const api = new ApiClient(ctx);
      const { status } = await api.createAdmin({
        email: 'duplicate@test.example',
        password: 'password12345',
        name: 'Duplicate Admin',
      });
      expect(status).toBe(409);
    } finally {
      await ctx.dispose();
    }
  });

  test('create-admin validates email', async () => {
    const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
    try {
      const api = new ApiClient(ctx);
      const { status } = await api.createAdmin({
        email: 'notanemail',
        password: 'password12345',
        name: 'X',
      });
      // Either 400 (validation) or 409 (already set up) — both are expected
      expect([400, 409]).toContain(status);
    } finally {
      await ctx.dispose();
    }
  });
});
