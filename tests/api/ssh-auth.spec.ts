/*
 * Real end-to-end SSH auth test.
 *
 * Creates a brand-new regular user, generates an ed25519 key pair, uploads
 * the public key to that user's account, creates a worker owned by that
 * user, starts the SSH app (which auto-allocates a 22xxx port mapping),
 * opens an actual SSH session against `localhost:<externalPort>`, and runs
 * `whoami` to prove that pubkey auth works end-to-end.
 *
 * Runs inside the dockerized test-runner — Traefik publishes every port
 * mapping on 127.0.0.1 of the test-runner's network namespace, so the
 * ssh2 client in this file reaches the inner worker through the same
 * `agentor-traefik` container the production path uses.
 */
import { test, expect, request as playwrightRequest } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
// `ssh2` ships as CommonJS; destructure from the default import so Playwright's
// ESM loader doesn't trip on named exports.
import ssh2 from 'ssh2';
const { Client, utils: sshUtils } = ssh2 as unknown as {
  Client: typeof import('ssh2').Client;
  utils: typeof import('ssh2').utils;
};
import { ApiClient } from '../helpers/api-client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN_STORAGE = resolve(__dirname, '..', '.auth/admin-api.json');

const UNAUTH_OPTS = {
  baseURL: BASE_URL,
  extraHTTPHeaders: { Origin: BASE_URL },
  storageState: { cookies: [], origins: [] },
};

interface TestUser {
  ctx: import('@playwright/test').APIRequestContext;
  api: ApiClient;
  id: string;
  email: string;
  password: string;
}

async function createUserAndSignIn(): Promise<TestUser> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const email = `ssh-${stamp}@test.example`;
  const password = `ssh-pass-${stamp}`;

  let id = '';
  const adminCtx = await playwrightRequest.newContext({ ...UNAUTH_OPTS, storageState: ADMIN_STORAGE });
  try {
    const res = await adminCtx.post('/api/auth/admin/create-user', {
      data: { email, password, name: 'SSH Auth Test', role: 'user' },
    });
    if (!res.ok()) throw new Error(`create-user failed: ${res.status()} ${await res.text()}`);
    const body = await res.json();
    id = body?.user?.id ?? body?.id ?? '';
    if (!id) throw new Error('admin create-user did not return a user id');
  } finally {
    await adminCtx.dispose();
  }

  const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
  const api = new ApiClient(ctx);
  const signIn = await api.signInEmail(email, password);
  if (signIn.status !== 200) {
    await ctx.dispose();
    throw new Error(`sign-in failed for ${email}: ${signIn.status}`);
  }
  return { ctx, api, id, email, password };
}

async function cleanupUser(user: TestUser): Promise<void> {
  await user.ctx.dispose().catch(() => {});
  const adminCtx = await playwrightRequest.newContext({ ...UNAUTH_OPTS, storageState: ADMIN_STORAGE });
  try {
    await adminCtx.post('/api/auth/admin/remove-user', { data: { userId: user.id } });
  } catch {
    // ignore
  } finally {
    await adminCtx.dispose();
  }
}

async function generateEd25519KeypairAsync(): Promise<{ publicKey: string; privateKey: string }> {
  return new Promise((resolveKeys, reject) => {
    sshUtils.generateKeyPair('ed25519', { comment: 'agentor-ssh-auth-test' }, (err, keys) => {
      if (err) return reject(err);
      resolveKeys({ publicKey: keys.public, privateKey: keys.private });
    });
  });
}

/** Wait for the SSH banner (`SSH-2.0-…`) on a TCP port. The plain TCP probe
 * isn't enough under parallel load because Traefik's recreated-container
 * window routes connections but forwards them to a backend that briefly
 * returns nothing. Reading the banner proves sshd is actually reachable
 * through the entrypoint before we run ssh2 against it. */
async function waitForSshBanner(host: string, port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: Error | null = null;
  while (Date.now() < deadline) {
    const attemptTimeoutMs = Math.min(3_000, deadline - Date.now());
    try {
      await new Promise<void>((resolveConn, reject) => {
        const socket = net.connect({ host, port });
        const timer = setTimeout(() => {
          socket.destroy();
          reject(new Error('ssh banner timeout'));
        }, attemptTimeoutMs);
        socket.once('data', (chunk: Buffer) => {
          clearTimeout(timer);
          socket.destroy();
          if (chunk.toString('utf8').startsWith('SSH-')) {
            resolveConn();
          } else {
            reject(new Error(`unexpected banner: ${chunk.toString('utf8').slice(0, 40)}`));
          }
        });
        socket.once('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });
      return;
    } catch (err) {
      lastErr = err as Error;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`ssh banner on ${host}:${port} not seen after ${timeoutMs}ms: ${lastErr?.message}`);
}

interface SshExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

async function sshExec(opts: {
  host: string;
  port: number;
  username: string;
  privateKey: string;
  command: string;
  connectTimeoutMs?: number;
}): Promise<SshExecResult> {
  return new Promise((resolveExec, reject) => {
    const client = new Client();
    let stdout = '';
    let stderr = '';
    let exitCode = -1;

    const timeout = setTimeout(() => {
      client.end();
      reject(new Error('ssh exec overall timeout'));
    }, 30_000);

    client.on('ready', () => {
      client.exec(opts.command, (err, stream) => {
        if (err) {
          clearTimeout(timeout);
          client.end();
          return reject(err);
        }
        stream.on('close', (code: number | null) => {
          clearTimeout(timeout);
          client.end();
          exitCode = typeof code === 'number' ? code : -1;
          resolveExec({ stdout, stderr, code: exitCode });
        });
        stream.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
        stream.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
      });
    });
    client.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    client.connect({
      host: opts.host,
      port: opts.port,
      username: opts.username,
      privateKey: opts.privateKey,
      readyTimeout: opts.connectTimeoutMs ?? 15_000,
      // Accept any host key — the worker regenerates host keys on first start
      // and we never stored them. This is safe for a one-shot test against a
      // known-localhost port mapping.
      hostVerifier: () => true,
      // Only offer the single key we just created; don't try to talk to an
      // ssh-agent (there isn't one in the test-runner).
      agent: undefined,
    });
  });
}

test.describe.serial('SSH auth end-to-end', () => {
  let user: TestUser;
  let containerId: string;
  let externalPort: number;
  let privateKey: string;

  test.beforeAll(async () => {
    user = await createUserAndSignIn();

    const keys = await generateEd25519KeypairAsync();
    privateKey = keys.privateKey;

    // Upload public key to the user's account. The orchestrator writes it to
    // `<DATA_DIR>/users/<userId>/ssh/authorized_keys` which is bind-mounted
    // into every worker this user owns.
    const putKey = await user.api.putAccountEnvVars({ sshPublicKey: keys.publicKey });
    expect(putKey.status).toBe(200);

    // Create a worker owned by this user. 90s timeout because the worker
    // entrypoint runs the full setup pipeline before the container is marked
    // running.
    const create = await user.api.createContainer({ displayName: `ssh-auth-${Date.now()}` });
    expect(create.status).toBe(201);
    containerId = create.body.id;

    // Poll for running state.
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const { body: list } = await user.api.listContainers();
      const me = (list as Array<{ id: string; status: string }>).find((c) => c.id === containerId);
      if (me?.status === 'running') break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    const { body: list } = await user.api.listContainers();
    const me = (list as Array<{ id: string; status: string }>).find((c) => c.id === containerId);
    expect(me?.status).toBe('running');
  });

  test.afterAll(async () => {
    if (containerId) {
      try {
        await user.api.removeContainer(containerId);
      } catch {
        // ignore
      }
    }
    if (user) await cleanupUser(user);
  });

  test('ssh app starts and allocates an external 22xxx port mapping', async () => {
    const { status, body } = await user.api.startApp(containerId, 'ssh');
    expect(status).toBe(201);
    expect(body.id).toBe('ssh');
    expect(body.port).toBe(22);
    expect(typeof body.externalPort).toBe('number');
    expect(body.externalPort).toBeGreaterThanOrEqual(22000);
    expect(body.externalPort).toBeLessThanOrEqual(22999);
    externalPort = body.externalPort;
  });

  test('remote `whoami` over ssh with the user-supplied pubkey returns `agent`', async () => {
    expect(externalPort).toBeTruthy();

    // Wait up to 20s for Traefik's new port entrypoint to be reachable. Adding
    // a port mapping triggers a Traefik container recreate; TCP handshake on
    // the external port stays refused until traefik finishes booting.
    await waitForSshBanner('127.0.0.1', externalPort, 30_000);

    try {
      const result = await sshExec({
        host: '127.0.0.1',
        port: externalPort,
        username: 'agent',
        privateKey,
        // Verify auth succeeded AND that /workspace is reachable from the
        // SSH session. SSH lands in the user's home dir (`/home/agent`) by
        // default — we `cd` explicitly to confirm the worker's workspace
        // volume is mounted and writable from the ssh session.
        command: 'whoami && cd /workspace && pwd && echo SSH_SUCCESS',
      });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('agent');
      expect(result.stdout).toContain('/workspace');
      expect(result.stdout).toContain('SSH_SUCCESS');
    } catch (err) {
      // SSH failed — dump diagnostic info from the worker so the failure is
      // actionable instead of "All configured authentication methods failed".
      const logs = await user.api.getContainerLogs(containerId, 500).catch(() => ({ body: { logs: '' } as any }));
      const tail: string = logs.body?.logs ?? (typeof logs.body === 'string' ? logs.body : JSON.stringify(logs.body ?? {}));
      const envVars = await user.api.getAccountEnvVars().catch(() => ({ body: null as any }));
      const savedKey = envVars.body?.sshPublicKey ?? '(not readable)';
      throw new Error(
        `SSH connect failed.\n` +
        `  error:        ${err instanceof Error ? err.message : err}\n` +
        `  externalPort: ${externalPort}\n` +
        `  savedPubKey:  ${String(savedKey).slice(0, 120)}...\n` +
        `  --- recent worker container logs (last 500 lines) ---\n${tail.slice(-6000)}`,
      );
    }
  });

  test('ssh auth fails when a different key is presented', async () => {
    expect(externalPort).toBeTruthy();
    // Generate a fresh key pair the worker has never seen. Connect should
    // fail with Authentication denied.
    const other = await generateEd25519KeypairAsync();

    let failed = false;
    try {
      await sshExec({
        host: '127.0.0.1',
        port: externalPort,
        username: 'agent',
        privateKey: other.privateKey,
        command: 'whoami',
        connectTimeoutMs: 8_000,
      });
    } catch (err: any) {
      failed = true;
      const message = String(err?.message ?? err);
      expect(message.toLowerCase()).toMatch(/(auth|permission|denied|all configured authentication methods failed)/);
    }
    expect(failed).toBe(true);
  });

  test('updating the public key propagates live (old key stops working)', async () => {
    expect(externalPort).toBeTruthy();
    // Rotate to a brand-new key and save it — the old privateKey should now
    // be rejected because the bind-mounted authorized_keys file only holds
    // the new pubkey.
    const rotated = await generateEd25519KeypairAsync();
    const putKey = await user.api.putAccountEnvVars({ sshPublicKey: rotated.publicKey });
    expect(putKey.status).toBe(200);

    // Give the file writer a moment to land (fs write is synchronous but the
    // kernel may take a beat for the bind-mounted view to refresh).
    await new Promise((r) => setTimeout(r, 500));

    // The OLD private key should now fail.
    let oldFailed = false;
    try {
      await sshExec({
        host: '127.0.0.1',
        port: externalPort,
        username: 'agent',
        privateKey,
        command: 'whoami',
        connectTimeoutMs: 8_000,
      });
    } catch {
      oldFailed = true;
    }
    expect(oldFailed).toBe(true);

    // And the NEW private key should work.
    const result = await sshExec({
      host: '127.0.0.1',
      port: externalPort,
      username: 'agent',
      privateKey: rotated.privateKey,
      command: 'whoami',
    });
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toContain('agent');

    // Swap the class-level key reference so cleanup + subsequent tests work.
    privateKey = rotated.privateKey;
  });
});
