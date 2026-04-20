import { test, expect, request as playwrightRequest } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { TerminalWsClient } from '../helpers/terminal-ws';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';
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
  return { ctx, api, email, id };
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

/** Reads `printenv NAME` from the running worker's terminal, returning the
 * trimmed value (or empty string if not set). Auto-retries once on transient
 * connect failures — under heavy parallel load the tmux pane can take a
 * moment to become reachable after the container reaches the running state. */
async function readEnvFromWorker(containerId: string, name: string): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 3000));
    }
    const ws = new TerminalWsClient(containerId);
    try {
      await ws.connect(15_000);
      await ws.waitForOutput(/\$\s*$/m, 45_000);
      ws.clearBuffer();
      const sentinel = `__AGENTOR_TEST_SENTINEL_${Math.random().toString(36).slice(2, 10)}__`;
      ws.sendLine(`echo "${sentinel}START"; printenv ${name}; echo "${sentinel}END"`);
      await ws.waitForOutput(new RegExp(`${sentinel}END`), 45_000);
      const buf = ws.getBuffer();
      const m = new RegExp(`${sentinel}START\\n([\\s\\S]*?)\\n${sentinel}END`).exec(buf);
      return m ? m[1]!.trim() : '';
    } catch (e) {
      lastErr = e;
    } finally {
      ws.close();
    }
  }
  throw lastErr;
}

test.describe('Per-user worker env vars', () => {
  test.describe.configure({ mode: 'serial' });

  test("well-known + custom env vars from the user's account propagate into their workers", async () => {
    test.setTimeout(240_000);

    // One combined test for well-known slots (GITHUB_TOKEN, ANTHROPIC_API_KEY)
    // plus a customEnvVars entry — same code path for all three, one worker
    // spin-up verifies the whole pipeline.
    const u = await createUserAndSignIn('env-combined');
    let containerId: string | undefined;
    try {
      const github = `gh-token-${Date.now()}`;
      const anthropic = `sk-ant-${Date.now()}`;
      await u.api.putAccountEnvVars({
        githubToken: github,
        anthropicApiKey: anthropic,
        customEnvVars: [{ key: 'AGENTOR_CUSTOM_X', value: 'hello-world-42' }],
      });

      const container = await createWorker(u.ctx, {
        displayName: `env-combined-${Date.now()}`,
      });
      containerId = container.id;

      expect(await readEnvFromWorker(container.id, 'GITHUB_TOKEN')).toBe(github);
      expect(await readEnvFromWorker(container.id, 'ANTHROPIC_API_KEY')).toBe(anthropic);
      expect(await readEnvFromWorker(container.id, 'AGENTOR_CUSTOM_X')).toBe('hello-world-42');
    } finally {
      if (containerId) await cleanupWorker(u.ctx, containerId);
      await cleanupUser(u);
    }
  });

  test("user B's worker uses B's token, not A's", async () => {
    test.setTimeout(240_000);

    const a = await createUserAndSignIn('env-iso-a');
    const b = await createUserAndSignIn('env-iso-b');
    let aContainerId: string | undefined;
    let bContainerId: string | undefined;
    try {
      await a.api.putAccountEnvVars({ githubToken: 'gh-USER-A' });
      await b.api.putAccountEnvVars({ githubToken: 'gh-USER-B' });

      const aContainer = await createWorker(a.ctx, { displayName: `iso-a-${Date.now()}` });
      aContainerId = aContainer.id;
      const bContainer = await createWorker(b.ctx, { displayName: `iso-b-${Date.now()}` });
      bContainerId = bContainer.id;

      const aGot = await readEnvFromWorker(aContainer.id, 'GITHUB_TOKEN');
      const bGot = await readEnvFromWorker(bContainer.id, 'GITHUB_TOKEN');
      expect(aGot).toBe('gh-USER-A');
      expect(bGot).toBe('gh-USER-B');
    } finally {
      if (aContainerId) await cleanupWorker(a.ctx, aContainerId);
      if (bContainerId) await cleanupWorker(b.ctx, bContainerId);
      await cleanupUser(a);
      await cleanupUser(b);
    }
  });

  test("an Environment's envVars override the user's account env vars", async () => {
    test.setTimeout(180_000);

    const u = await createUserAndSignIn('env-override');
    let containerId: string | undefined;
    let environmentId: string | undefined;
    try {
      await u.api.putAccountEnvVars({ githubToken: 'gh-from-account' });

      // Create a custom environment with envVars overriding GITHUB_TOKEN.
      const env = await u.api.createEnvironment({
        name: `env-override-${Date.now()}`,
        cpuLimit: 0,
        memoryLimit: '',
        networkMode: 'full',
        allowedDomains: [],
        includePackageManagerDomains: false,
        dockerEnabled: false,
        envVars: 'GITHUB_TOKEN=gh-from-environment\n',
        setupScript: '',
        exposeApis: { portMappings: true, domainMappings: true, usage: true },
        enabledCapabilityIds: null,
        enabledInstructionIds: null,
      });
      expect(env.status).toBe(201);
      environmentId = env.body.id;

      const container = await createWorker(u.ctx, {
        displayName: `env-override-${Date.now()}`,
        environmentId,
      });
      containerId = container.id;

      const got = await readEnvFromWorker(container.id, 'GITHUB_TOKEN');
      // Environment.envVars are exported by the entrypoint AFTER Docker's
      // env array, so they win.
      expect(got).toBe('gh-from-environment');
    } finally {
      if (containerId) await cleanupWorker(u.ctx, containerId);
      if (environmentId) await u.api.deleteEnvironment(environmentId);
      await cleanupUser(u);
    }
  });
});
