import { test, expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createWorker, cleanupWorker, waitForWorkerRunning } from '../helpers/worker-lifecycle';
import { runInFreshWindow } from '../helpers/terminal-ws';
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

/** Create a regular (non-admin) user and return a request context signed in as them. */
async function createRegularUserContext(email: string, password: string, name: string): Promise<APIRequestContext> {
  const ctx = await playwrightRequest.newContext(CONTEXT_OPTS);
  const adminCtx = await playwrightRequest.newContext({ ...CONTEXT_OPTS, storageState: ADMIN_STORAGE });
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

// `runInFreshWindow` (from terminal-ws) runs a command in a fresh tmux window
// and waits for a pattern. Because the worker's shell echoes the typed command
// back into the buffer, every "applied" check below asserts on a value the shell
// COMPUTES at runtime (a `grep -ca` count interpolated via `$( )`) — that token
// can only appear in the command's OUTPUT, never in the echoed command, so the
// assertion is not vacuous.

// ─────────────────────────────────────────────────────────────────────────────
// PATCH metadata + validation (one shared worker, no rebuilds)
// ─────────────────────────────────────────────────────────────────────────────
test.describe.serial('Worker settings — PATCH metadata & validation', () => {
  let worker: { id: string; [k: string]: unknown };
  let customEnvId: string | undefined;

  test.beforeAll(async ({ request }) => {
    worker = await createWorker(request);
    const api = new ApiClient(request);
    const { status, body } = await api.createEnvironment({ name: `wset-meta-env-${Date.now()}`, networkMode: 'full' });
    expect(status).toBe(201);
    customEnvId = body.id;
  });

  test.afterAll(async ({ request }) => {
    const api = new ApiClient(request);
    if (worker) await cleanupWorker(request, worker.id);
    if (customEnvId) await api.deleteEnvironment(customEnvId).catch(() => {});
  });

  test('displayName applies immediately — no pendingRebuild, identity unchanged', async ({ request }) => {
    const api = new ApiClient(request);
    const label = `live-${Date.now()}`;
    const { status, body } = await api.updateContainerSettings(worker.id, { displayName: label });
    expect(status).toBe(200);
    expect(body.displayName).toBe(label);
    expect(body.id).toBe(worker.id);     // UUID id immutable; not recreated
    expect(body.pendingRebuild).toBeFalsy();

    const { body: list } = await api.listContainers();
    const found = list.find((c: { id: string }) => c.id === worker.id);
    expect(found.displayName).toBe(label);
    expect(found.pendingRebuild).toBeFalsy();
  });

  test('environmentId change flags pendingRebuild and stores only the FK', async ({ request }) => {
    const api = new ApiClient(request);
    const { status, body } = await api.updateContainerSettings(worker.id, { environmentId: customEnvId });
    expect(status).toBe(200);
    expect(body.environmentId).toBe(customEnvId);
    // Only the FK is stored — the env config is not snapshotted onto the worker.
    expect(body.environmentName).toBeUndefined();
    expect(body.networkMode).toBeUndefined();
    expect(body.pendingRebuild).toBe(true);
    expect(body.id).toBe(worker.id); // still not recreated — only stored
  });

  test('initScript change flags pendingRebuild and stores the script', async ({ request }) => {
    const api = new ApiClient(request);
    const script = `echo init-${Date.now()}`;
    const { status, body } = await api.updateContainerSettings(worker.id, { initScript: script });
    expect(status).toBe(200);
    expect(body.initScript).toBe(script);
    expect(body.pendingRebuild).toBe(true);
  });

  test('repos change flags pendingRebuild and stores the repo list', async ({ request }) => {
    const api = new ApiClient(request);
    const url = 'https://github.com/octocat/Hello-World';
    const { status, body } = await api.updateContainerSettings(worker.id, {
      repos: [{ provider: 'github', url, branch: 'master' }],
    });
    expect(status).toBe(200);
    expect(Array.isArray(body.repos)).toBe(true);
    expect(body.repos).toHaveLength(1);
    expect(body.repos[0].url).toBe(url);
    expect(body.repos[0].branch).toBe('master');
    expect(body.pendingRebuild).toBe(true);
  });

  test('mounts change flags pendingRebuild and stores the mount list', async ({ request }) => {
    const api = new ApiClient(request);
    const { status, body } = await api.updateContainerSettings(worker.id, {
      mounts: [{ source: '/tmp', target: '/mnt/wset-meta', readOnly: true }],
    });
    expect(status).toBe(200);
    expect(Array.isArray(body.mounts)).toBe(true);
    expect(body.mounts).toHaveLength(1);
    expect(body.mounts[0].source).toBe('/tmp');
    expect(body.mounts[0].target).toBe('/mnt/wset-meta');
    expect(body.mounts[0].readOnly).toBe(true);
    expect(body.pendingRebuild).toBe(true);
  });

  test('partial update changes only the targeted field', async ({ request }) => {
    const api = new ApiClient(request);
    // Establish a known baseline for two rebuild fields.
    const baseScript = `echo base-${Date.now()}`;
    await api.updateContainerSettings(worker.id, { initScript: baseScript, displayName: 'baseline-label' });
    // Now change ONLY the display name.
    const newLabel = `partial-${Date.now()}`;
    const { status, body } = await api.updateContainerSettings(worker.id, { displayName: newLabel });
    expect(status).toBe(200);
    expect(body.displayName).toBe(newLabel);
    expect(body.initScript).toBe(baseScript); // untouched
  });

  test('clearing initScript with an empty string removes it', async ({ request }) => {
    const api = new ApiClient(request);
    await api.updateContainerSettings(worker.id, { initScript: 'echo something' });
    const { status, body } = await api.updateContainerSettings(worker.id, { initScript: '' });
    expect(status).toBe(200);
    expect(body.initScript == null || body.initScript === '').toBe(true);
  });

  test('empty / whitespace displayName is rejected with 400', async ({ request }) => {
    const api = new ApiClient(request);
    expect((await api.updateContainerSettings(worker.id, { displayName: '' })).status).toBe(400);
    expect((await api.updateContainerSettings(worker.id, { displayName: '   ' })).status).toBe(400);
  });

  test('displayName longer than 100 chars is rejected with 400', async ({ request }) => {
    const api = new ApiClient(request);
    const { status } = await api.updateContainerSettings(worker.id, { displayName: 'x'.repeat(101) });
    expect(status).toBe(400);
  });

  test('non-existent environmentId is rejected with 400', async ({ request }) => {
    const api = new ApiClient(request);
    const { status } = await api.updateContainerSettings(worker.id, { environmentId: 'does-not-exist-xyz' });
    expect(status).toBe(400);
  });

  test('malformed repos / mounts are rejected with 400', async ({ request }) => {
    const api = new ApiClient(request);
    // repos that don't parse as JSON / aren't an array
    expect((await api.updateContainerSettings(worker.id, { repos: 'not-json' })).status).toBe(400);
    // mount with a non-string source
    expect((await api.updateContainerSettings(worker.id, { mounts: [{ source: 123, target: '/x' }] })).status).toBe(400);
  });

  test('unsafe mounts are rejected with 400 on PATCH', async ({ request }) => {
    const api = new ApiClient(request);
    // colon in source/target (Docker mount-option injection)
    expect((await api.updateContainerSettings(worker.id, { mounts: [{ source: '/tmp:rshared', target: '/x' }] })).status).toBe(400);
    expect((await api.updateContainerSettings(worker.id, { mounts: [{ source: '/tmp', target: '/x:Z' }] })).status).toBe(400);
    // the Docker socket and the data directory are off-limits
    expect((await api.updateContainerSettings(worker.id, { mounts: [{ source: '/var/run/docker.sock', target: '/sock' }] })).status).toBe(400);
    expect((await api.updateContainerSettings(worker.id, { mounts: [{ source: '/data/users', target: '/steal' }] })).status).toBe(400);
  });

  test('PATCH on a non-existent container returns 404', async ({ request }) => {
    const api = new ApiClient(request);
    const { status } = await api.updateContainerSettings('non-existent-id', { displayName: 'whatever' });
    expect(status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ownership
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Worker settings — ownership', () => {
  test('a regular user cannot update another user\'s worker settings', async ({ request }) => {
    const adminWorker = await createWorker(request);
    let userCtx: APIRequestContext | undefined;
    try {
      userCtx = await createRegularUserContext(
        `wset-${Date.now()}@test.example`,
        'test-password-12345',
        'WSet Regular User',
      );
    } catch (err) {
      await cleanupWorker(request, adminWorker.id);
      test.skip(true, `Skipping — cannot create regular user: ${(err as Error).message}`);
      return;
    }
    try {
      const userApi = new ApiClient(userCtx);
      const { status } = await userApi.updateContainerSettings(adminWorker.id, { displayName: 'hijacked' });
      // The worker is in the orchestrator's in-memory map, so it resolves and
      // then fails the ownership check — a deterministic 403 (not a 404).
      expect(status).toBe(403);
    } finally {
      await userCtx.dispose();
      await cleanupWorker(request, adminWorker.id);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Applied after rebuild (verify the running container actually reflects edits)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Worker settings — applied after rebuild', () => {
  test('init script, repos and mounts are baked in only after a rebuild', async ({ request }) => {
    test.setTimeout(360_000);
    const api = new ApiClient(request);
    const worker = await createWorker(request);
    const initMarker = `WSETINIT${Date.now()}`;
    const repoUrl = 'https://github.com/octocat/Hello-World';
    const mountTarget = `/mnt/wset${Date.now()}`;

    try {
      // Edit three rebuild-requiring settings at once.
      const { status, body } = await api.updateContainerSettings(worker.id, {
        initScript: `echo ${initMarker}`,
        repos: [{ provider: 'github', url: repoUrl }],
        mounts: [{ source: '/tmp', target: mountTarget, readOnly: true }],
      });
      expect(status).toBe(200);
      expect(body.pendingRebuild).toBe(true);

      // Before rebuild: the RUNNING container's baked WORKER env does NOT yet
      // contain the new init marker — the edit is only stored. The count is
      // computed by the shell (`$( )`), so it can't leak from the command echo.
      const before = await runInFreshWindow(
        request,
        worker.id,
        `echo "WSPRE=$(grep -ca '${initMarker}' /proc/1/environ)"`,
        /WSPRE=\d/,
      );
      expect(before).toContain('WSPRE=0');

      // Rebuild applies the stored config.
      const { status: rbStatus, body: rebuilt } = await api.rebuildContainer(worker.id);
      expect(rbStatus).toBe(200);
      const newId = rebuilt.id;
      expect(rebuilt.pendingRebuild).toBeFalsy();
      await waitForWorkerRunning(request, newId, 120_000);

      // After rebuild: the new container's WORKER env carries the init script and
      // the repo URL, and the bind mount is active. Each count is computed at
      // runtime, so 1/0 only appears in the OUTPUT — never in the echoed command.
      const after = await runInFreshWindow(
        request,
        newId,
        `echo "WSPOST I=$(grep -ca '${initMarker}' /proc/1/environ)` +
        ` R=$(grep -ca 'Hello-World' /proc/1/environ)` +
        ` M=$(grep -ca '${mountTarget}' /proc/mounts)"`,
        /WSPOST I=\d R=\d M=\d/,
        60_000,
      );
      const m = after.match(/WSPOST I=(\d) R=(\d) M=(\d)/);
      expect(m, `no computed result line in:\n${after.slice(-400)}`).toBeTruthy();
      expect(m![1]).toBe('1'); // init script baked into WORKER env
      expect(m![2]).toBe('1'); // repo URL baked into WORKER env
      expect(m![3]).toBe('1'); // bind mount active in /proc/mounts

      // Metadata reflects the applied config and the pending flag is cleared.
      const { body: list } = await api.listContainers();
      const found = list.find((c: { id: string }) => c.id === newId);
      expect(found).toBeTruthy();
      expect(found.pendingRebuild).toBeFalsy();
      expect(found.initScript).toBe(`echo ${initMarker}`);
      expect(found.repos?.[0]?.url).toBe(repoUrl);
      expect(found.mounts?.[0]?.target).toBe(mountTarget);

      await cleanupWorker(request, newId);
    } catch (err) {
      await cleanupWorker(request, worker.id).catch(() => {});
      throw err;
    }
  });

  test('reassigning the environment is applied after a rebuild', async ({ request }) => {
    test.setTimeout(360_000);
    const api = new ApiClient(request);
    const marker = `WSETENV${Date.now()}`;
    const { status: envStatus, body: env } = await api.createEnvironment({
      name: `wset-apply-env-${Date.now()}`,
      networkMode: 'full',
      envVars: `WSET_ENV_MARKER=${marker}`,
    });
    expect(envStatus).toBe(201);

    const worker = await createWorker(request);
    try {
      // Before: default env — the new env's marker is nowhere in the container's
      // baked ENVIRONMENT. (Read /proc/1/environ, set at container creation, so
      // there's no dependency on how far the entrypoint has progressed. The count
      // is computed by the shell, so it can't leak from the command echo.)
      const before = await runInFreshWindow(
        request,
        worker.id,
        `echo "WSENVPRE=$(grep -ca '${marker}' /proc/1/environ)"`,
        /WSENVPRE=\d/,
      );
      expect(before).toContain('WSENVPRE=0');

      const { status, body } = await api.updateContainerSettings(worker.id, { environmentId: env.id });
      expect(status).toBe(200);
      expect(body.environmentId).toBe(env.id);
      expect(body.pendingRebuild).toBe(true);

      const { body: rebuilt } = await api.rebuildContainer(worker.id);
      const newId = rebuilt.id;
      await waitForWorkerRunning(request, newId, 120_000);

      // After rebuild: the new container was created with the reassigned
      // environment, so its baked ENVIRONMENT JSON carries the custom var.
      const after = await runInFreshWindow(
        request,
        newId,
        `echo "WSENVPOST=$(grep -ca '${marker}' /proc/1/environ)"`,
        /WSENVPOST=\d/,
        60_000,
      );
      expect(after).toContain('WSENVPOST=1');

      const { body: list } = await api.listContainers();
      const found = list.find((c: { id: string }) => c.id === newId);
      expect(found.environmentId).toBe(env.id);
      expect(found.pendingRebuild).toBeFalsy();

      await cleanupWorker(request, newId);
    } catch (err) {
      await cleanupWorker(request, worker.id).catch(() => {});
      throw err;
    } finally {
      await api.deleteEnvironment(env.id).catch(() => {});
    }
  });

  test('pendingRebuild survives a restart and is cleared only by rebuild', async ({ request }) => {
    test.setTimeout(240_000);
    const api = new ApiClient(request);
    const worker = await createWorker(request);
    try {
      const { body: patched } = await api.updateContainerSettings(worker.id, { initScript: `echo r-${Date.now()}` });
      expect(patched.pendingRebuild).toBe(true);

      // A restart does NOT apply rebuild-requiring edits — the flag stays.
      await api.restartContainer(worker.id);
      await waitForWorkerRunning(request, worker.id, 90_000);
      let { body: list } = await api.listContainers();
      let found = list.find((c: { id: string }) => c.id === worker.id);
      expect(found.pendingRebuild).toBe(true);

      // A rebuild applies them and clears the flag.
      const { body: rebuilt } = await api.rebuildContainer(worker.id);
      await waitForWorkerRunning(request, rebuilt.id, 120_000);
      ({ body: list } = await api.listContainers());
      found = list.find((c: { id: string }) => c.id === rebuilt.id);
      expect(found.pendingRebuild).toBeFalsy();

      await cleanupWorker(request, rebuilt.id);
    } catch (err) {
      await cleanupWorker(request, worker.id).catch(() => {});
      throw err;
    }
  });
});
