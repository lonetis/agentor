import { test, expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createTestUser, deleteTestUser, type CreatedUser } from '../helpers/test-users';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const UNAUTH_OPTS = {
  baseURL: BASE_URL,
  extraHTTPHeaders: { Origin: BASE_URL },
  storageState: { cookies: [], origins: [] },
};

async function signedInContext(user: CreatedUser): Promise<APIRequestContext> {
  const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
  const api = new ApiClient(ctx);
  const signIn = await api.signInEmail(user.email, user.password);
  if (signIn.status !== 200) {
    await ctx.dispose();
    throw new Error(`Failed to sign in ${user.email}: ${signIn.status}`);
  }
  return ctx;
}

/**
 * Regression coverage for per-user resource ownership across every resource
 * type the orchestrator exposes. Regular users must see only their own
 * resources + built-in/global rows; admins see everything.
 *
 * These tests use two users (alice, bob) and verify that each user's
 * resources do not leak into the other's list responses.
 */
test.describe.serial('Resource ownership per user', () => {
  let alice: CreatedUser;
  let bob: CreatedUser;
  let aliceCtx: APIRequestContext;
  let bobCtx: APIRequestContext;

  test.beforeAll(async () => {
    alice = await createTestUser('Alice Owner');
    bob = await createTestUser('Bob Owner');
    aliceCtx = await signedInContext(alice);
    bobCtx = await signedInContext(bob);
  });

  test.afterAll(async () => {
    await aliceCtx?.dispose();
    await bobCtx?.dispose();
    if (alice) await deleteTestUser(alice.id);
    if (bob) await deleteTestUser(bob.id);
  });

  test('environments: user-created environment is not visible to other users', async () => {
    const createRes = await aliceCtx.post('/api/environments', {
      data: { name: `alice-env-${Date.now()}` },
    });
    expect(createRes.status()).toBe(201);
    const env = await createRes.json();
    const envId = env?.id;
    expect(envId).toBeTruthy();

    // Alice sees her env
    const aliceList = await (await aliceCtx.get('/api/environments')).json();
    const aliceHas = aliceList.some((e: any) => e.id === envId);
    expect(aliceHas).toBe(true);

    // Bob does NOT see alice's env
    const bobList = await (await bobCtx.get('/api/environments')).json();
    const bobHas = bobList.some((e: any) => e.id === envId);
    expect(bobHas).toBe(false);

    // Bob cannot read it directly
    const bobGet = await bobCtx.get(`/api/environments/${envId}`);
    expect(bobGet.status()).toBe(403);

    // Bob cannot delete it
    const bobDel = await bobCtx.delete(`/api/environments/${envId}`);
    expect(bobDel.status()).toBe(403);

    // Alice can delete it
    const aliceDel = await aliceCtx.delete(`/api/environments/${envId}`);
    expect(aliceDel.status()).toBe(200);
  });

  test('capabilities: user-created capability is not visible to other users', async () => {
    const createRes = await aliceCtx.post('/api/capabilities', {
      data: { name: `alice-cap-${Date.now()}`, content: '---\nname: test\ndescription: x\n---\n# Test\n' },
    });
    expect(createRes.status()).toBe(201);
    const cap = await createRes.json();
    const capId = cap?.id;

    const bobList = await (await bobCtx.get('/api/capabilities')).json();
    const bobHas = bobList.some((c: any) => c.id === capId);
    expect(bobHas).toBe(false);

    const bobGet = await bobCtx.get(`/api/capabilities/${capId}`);
    expect(bobGet.status()).toBe(403);

    const aliceDel = await aliceCtx.delete(`/api/capabilities/${capId}`);
    expect(aliceDel.status()).toBe(200);
  });

  test('instructions: user-created instruction is not visible to other users', async () => {
    const createRes = await aliceCtx.post('/api/instructions', {
      data: { name: `alice-inst-${Date.now()}`, content: '# Alice rules\nBe nice.' },
    });
    expect(createRes.status()).toBe(201);
    const inst = await createRes.json();
    const instId = inst?.id;

    const bobList = await (await bobCtx.get('/api/instructions')).json();
    const bobHas = bobList.some((i: any) => i.id === instId);
    expect(bobHas).toBe(false);

    const bobGet = await bobCtx.get(`/api/instructions/${instId}`);
    expect(bobGet.status()).toBe(403);

    const aliceDel = await aliceCtx.delete(`/api/instructions/${instId}`);
    expect(aliceDel.status()).toBe(200);
  });

  test('init-scripts: user-created init script is not visible to other users', async () => {
    const createRes = await aliceCtx.post('/api/init-scripts', {
      data: { name: `alice-init-${Date.now()}`, content: '#!/bin/bash\necho alice\n' },
    });
    expect(createRes.status()).toBe(201);
    const scr = await createRes.json();
    const scrId = scr?.id;

    const bobList = await (await bobCtx.get('/api/init-scripts')).json();
    const bobHas = bobList.some((s: any) => s.id === scrId);
    expect(bobHas).toBe(false);

    const bobGet = await bobCtx.get(`/api/init-scripts/${scrId}`);
    expect(bobGet.status()).toBe(403);

    const aliceDel = await aliceCtx.delete(`/api/init-scripts/${scrId}`);
    expect(aliceDel.status()).toBe(200);
  });

  test('built-in resources are visible to every user', async () => {
    // Built-in environments/capabilities/instructions are seeded on startup.
    // Both alice and bob should see the same built-in rows.
    const aliceEnvs = await (await aliceCtx.get('/api/environments')).json();
    const bobEnvs = await (await bobCtx.get('/api/environments')).json();
    const aliceBuiltIns = aliceEnvs.filter((e: any) => e.builtIn).map((e: any) => e.id).sort();
    const bobBuiltIns = bobEnvs.filter((e: any) => e.builtIn).map((e: any) => e.id).sort();
    expect(aliceBuiltIns).toEqual(bobBuiltIns);
    expect(aliceBuiltIns.length).toBeGreaterThan(0);

    const aliceCaps = await (await aliceCtx.get('/api/capabilities')).json();
    const bobCaps = await (await bobCtx.get('/api/capabilities')).json();
    const aliceCapIds = aliceCaps.filter((c: any) => c.builtIn).map((c: any) => c.id).sort();
    const bobCapIds = bobCaps.filter((c: any) => c.builtIn).map((c: any) => c.id).sort();
    expect(aliceCapIds).toEqual(bobCapIds);
    expect(aliceCapIds.length).toBeGreaterThan(0);
  });

  test('built-in resources cannot be modified by regular users', async () => {
    const envs = await (await aliceCtx.get('/api/environments')).json();
    const builtIn = envs.find((e: any) => e.builtIn);
    expect(builtIn).toBeTruthy();

    // PUT a built-in environment — server refuses with 400 "Cannot modify"
    const update = await aliceCtx.put(`/api/environments/${builtIn.id}`, {
      data: { name: 'hijack-attempt' },
    });
    expect(update.status()).toBeGreaterThanOrEqual(400);

    // DELETE built-in environment — refused
    const del = await aliceCtx.delete(`/api/environments/${builtIn.id}`);
    expect(del.status()).toBeGreaterThanOrEqual(400);
  });

  test('admin sees all users environments including alices', async ({ request }) => {
    // Alice creates one
    const created = await aliceCtx.post('/api/environments', {
      data: { name: `admin-visible-${Date.now()}` },
    });
    const env = await created.json();
    const envId = env?.id;

    try {
      const adminList = await (await request.get('/api/environments')).json();
      const found = adminList.find((e: any) => e.id === envId);
      expect(found).toBeTruthy();
      expect(found.userId).toBe(alice.id);
    } finally {
      await aliceCtx.delete(`/api/environments/${envId}`);
    }
  });

  test('archived worker listing is scoped by user', async ({ request }) => {
    // Admin sees all archived workers
    const adminList = await (await request.get('/api/archived')).json();
    expect(Array.isArray(adminList)).toBe(true);

    // A fresh user sees no archived workers (they haven't archived anything)
    const aliceList = await (await aliceCtx.get('/api/archived')).json();
    expect(Array.isArray(aliceList)).toBe(true);
    // Alice hasn't archived anything, so her list should be empty or at most
    // contain entries she owns (no cross-user leakage).
    for (const w of aliceList) {
      expect(w.userId === alice.id).toBe(true);
    }
  });

  test('port mappings list is scoped by user', async ({ request }) => {
    // Alice's list should not contain any mapping owned by another user.
    const aliceList = await (await aliceCtx.get('/api/port-mappings')).json();
    expect(Array.isArray(aliceList)).toBe(true);
    for (const m of aliceList) {
      expect(m.userId).toBe(alice.id);
    }

    // Admin sees all mappings unfiltered.
    const adminList = await (await request.get('/api/port-mappings')).json();
    expect(Array.isArray(adminList)).toBe(true);
  });

  test('domain mappings list is scoped by user', async ({ request }) => {
    const aliceList = await (await aliceCtx.get('/api/domain-mappings')).json();
    expect(Array.isArray(aliceList)).toBe(true);
    for (const m of aliceList) {
      expect(m.userId).toBe(alice.id);
    }

    const adminList = await (await request.get('/api/domain-mappings')).json();
    expect(Array.isArray(adminList)).toBe(true);
  });
});
