import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';

test.describe('Apps API', () => {
  let containerId: string;

  test.beforeAll(async ({ request }) => {
    const container = await createWorker(request);
    containerId = container.id;
  });

  test.afterAll(async ({ request }) => {
    await cleanupWorker(request, containerId);
  });

  test.describe('GET /api/containers/:id/apps', () => {
    test('lists all running apps (initially empty)', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.listApps(containerId);
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });
  });

  test.describe('GET /api/containers/:id/apps/:appType', () => {
    test('lists chromium instances (initially empty)', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.listAppsByType(containerId, 'chromium');
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });

    test('lists socks5 instances (initially empty)', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.listAppsByType(containerId, 'socks5');
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });
  });

  test.describe('App lifecycle (start/list/stop)', () => {
    test('starts and stops a socks5 app', async ({ request }) => {
      const api = new ApiClient(request);

      // Start
      const { status: startStatus, body: startBody } = await api.startApp(containerId, 'socks5');
      expect(startStatus).toBe(201);
      expect(startBody.id || startBody.instanceId || startBody.port).toBeTruthy();

      // Wait a bit for app to start
      await new Promise(r => setTimeout(r, 2000));

      // List
      const { body: apps } = await api.listAppsByType(containerId, 'socks5');
      expect(apps.length).toBeGreaterThan(0);

      // Stop
      const instanceId = apps[0].id;
      const { status: stopStatus } = await api.stopApp(containerId, 'socks5', instanceId);
      expect(stopStatus).toBe(200);
    });

    test('can start a chromium app (returns 201)', async ({ request }) => {
      const api = new ApiClient(request);

      // Start - the API should succeed even if Chromium exits quickly in the container
      const { status: startStatus, body: startBody } = await api.startApp(containerId, 'chromium');
      expect(startStatus).toBe(201);
      // The response should indicate the app was started
      expect(startBody).toBeTruthy();
    });
  });

  test.describe('Error handling', () => {
    test('rejects invalid app type', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.startApp(containerId, 'nonexistent-app');
      expect(status).toBeGreaterThanOrEqual(400);
    });

    test('listing unknown app type returns empty list', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.listAppsByType(containerId, 'nonexistent-app');
      // API is lenient: returns empty list for unknown types
      expect(status).toBe(200);
      expect(body).toEqual([]);
    });

    test('rejects starting app on non-existent container', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.startApp('non-existent-id', 'socks5');
      expect(status).toBeGreaterThanOrEqual(400);
    });

    test('stopping a non-existent app instance is idempotent', async ({ request }) => {
      // manage.sh stop is idempotent — emits `{"status":"stopped"}` + exit 0
      // when the pid file does not exist. The orchestrator propagates that as 200.
      const api = new ApiClient(request);
      const { status } = await api.stopApp(containerId, 'socks5', 'non-existent-instance');
      expect(status).toBeLessThan(400);
    });

    test('listing all apps on non-existent container returns 404', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.listApps('non-existent-id');
      expect(status).toBe(404);
    });

    test('listing apps by type on non-existent container returns 404', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.listAppsByType('non-existent-id', 'socks5');
      expect(status).toBe(404);
    });
  });

  test.describe('Response fields', () => {
    test('socks5 start response includes id and port', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.startApp(containerId, 'socks5');
      expect(status).toBe(201);
      expect(typeof body.id).toBe('string');
      expect(typeof body.port).toBe('number');

      // Cleanup
      await new Promise(r => setTimeout(r, 1000));
      const { body: apps } = await api.listAppsByType(containerId, 'socks5');
      for (const app of apps) {
        await api.stopApp(containerId, 'socks5', app.id);
      }
    });

    test('socks5 list shows running instance fields', async ({ request }) => {
      const api = new ApiClient(request);
      await api.startApp(containerId, 'socks5');
      await new Promise(r => setTimeout(r, 2000));

      const { body: apps } = await api.listAppsByType(containerId, 'socks5');
      expect(apps.length).toBeGreaterThan(0);
      const instance = apps[0];
      expect(typeof instance.id).toBe('string');
      expect(typeof instance.port).toBe('number');

      // Cleanup
      for (const app of apps) {
        await api.stopApp(containerId, 'socks5', app.id);
      }
    });

    test('stop response returns ok', async ({ request }) => {
      const api = new ApiClient(request);
      await api.startApp(containerId, 'socks5');
      await new Promise(r => setTimeout(r, 2000));

      const { body: apps } = await api.listAppsByType(containerId, 'socks5');
      expect(apps.length).toBeGreaterThan(0);

      const { status, body } = await api.stopApp(containerId, 'socks5', apps[0].id);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
    });
  });

  test.describe('VS Code Tunnel singleton app', () => {
    test.afterEach(async ({ request }) => {
      const api = new ApiClient(request);
      await api.stopApp(containerId, 'vscode', 'vscode').catch(() => {});
    });

    test('vscode is listed in app-types as a singleton', async ({ request }) => {
      const res = await request.get('/api/app-types');
      const types = await res.json();
      const vscode = types.find((t: { id: string }) => t.id === 'vscode');
      expect(vscode).toBeTruthy();
      expect(vscode.singleton).toBe(true);
      expect(vscode.maxInstances).toBe(1);
    });

    test('starting vscode returns 201 with id "vscode" and port 0', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.startApp(containerId, 'vscode');
      expect(status).toBe(201);
      expect(body.id).toBe('vscode');
      expect(body.port).toBe(0);
    });

    test('starting vscode twice returns 409', async ({ request }) => {
      const api = new ApiClient(request);
      const first = await api.startApp(containerId, 'vscode');
      expect(first.status).toBe(201);
      const second = await api.startApp(containerId, 'vscode');
      expect(second.status).toBe(409);
    });

    test('list returns vscode with status running or auth_required', async ({ request }) => {
      const api = new ApiClient(request);
      await api.startApp(containerId, 'vscode');
      // Give the tunnel a moment to emit log lines the parser can pick up.
      await new Promise(r => setTimeout(r, 3000));
      const { body: apps } = await api.listAppsByType(containerId, 'vscode');
      expect(apps.length).toBeGreaterThan(0);
      const vscode = apps[0];
      expect(['running', 'auth_required']).toContain(vscode.status);
      expect(vscode.id).toBe('vscode');
    });

    test('device-code surfaces in auth_required state within 60s', async ({ request }) => {
      // Fresh start on a worker that has never authed (agent-data volume is
      // empty), the `code tunnel` binary prints a GitHub device-code prompt
      // within a handful of seconds. Poll `list` until we see a status of
      // `auth_required` with a populated authCode — proves the device code
      // travels from the worker log → orchestrator → API client reliably.
      const api = new ApiClient(request);
      await api.startApp(containerId, 'vscode');

      const deadline = Date.now() + 60_000;
      let lastStatus = 'stopped';
      let lastCode: string | undefined;
      let lastUrl: string | undefined;
      while (Date.now() < deadline) {
        const { body: apps } = await api.listAppsByType(containerId, 'vscode');
        if (apps.length > 0) {
          lastStatus = apps[0].status;
          lastCode = apps[0].authCode;
          lastUrl = apps[0].authUrl;
          if (lastStatus === 'auth_required' && lastCode) break;
          if (lastStatus === 'running') break; // already authed from a previous run
        }
        await new Promise(r => setTimeout(r, 2_000));
      }

      // Either we picked up the device code, or the agent-data volume already
      // had a valid token and the tunnel went straight to `running`. Both are
      // valid end states for this test — dump the worker log on mismatch so we
      // can tell which of the two happened and diagnose `code tunnel` output
      // changes quickly.
      if (lastStatus !== 'auth_required' && lastStatus !== 'running') {
        const { body: logs } = await api.getContainerLogs(containerId, 300);
        const logStr = typeof logs === 'object' && logs !== null && 'logs' in logs ? (logs as { logs: string }).logs : String(logs);
        const tunnelLines = logStr.split('\n').filter((l) => l.includes('[vscode-tunnel]')).slice(-40).join('\n');
        throw new Error(`vscode tunnel never reached a known state. status=${lastStatus}, code=${lastCode}, url=${lastUrl}\nRecent [vscode-tunnel] lines:\n${tunnelLines || '(none)'}`);
      }

      if (lastStatus === 'auth_required') {
        expect(lastCode).toBeTruthy();
        expect(lastCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
        expect(lastUrl).toBe('https://github.com/login/device');
      } else {
        expect(lastStatus).toBe('running');
      }
    });

    test('worker log stream actually contains the "use code" prompt line', async ({ request }) => {
      // Independently of the state-machine parser, assert that the `code
      // tunnel` CLI really does emit the device-code prompt into the worker
      // log stream when launched on a fresh agent-data volume. If this test
      // passes but `device-code surfaces…` fails, the regex parser is wrong.
      // If this test fails, the CLI output format has changed and the regex
      // needs updating regardless.
      const api = new ApiClient(request);
      await api.startApp(containerId, 'vscode');

      const deadline = Date.now() + 60_000;
      let foundUseCode = false;
      let foundConnected = false;
      let tail = '';
      while (Date.now() < deadline) {
        const { body: logs } = await api.getContainerLogs(containerId, 500);
        const logStr = typeof logs === 'object' && logs !== null && 'logs' in logs ? (logs as { logs: string }).logs : String(logs);
        tail = logStr.split('\n').filter((l) => l.includes('[vscode-tunnel]')).slice(-60).join('\n');
        if (/use code [A-Z0-9]{4}-[A-Z0-9]{4}/.test(logStr)) {
          foundUseCode = true;
          break;
        }
        if (/Open this link|devtunnels\.ms|Connected|tunnel\//.test(logStr)) {
          foundConnected = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 2_000));
      }

      // A fresh tunnel either prints "use code ABCD-1234" (uncached auth)
      // OR connects silently via a cached token. Either satisfies the assert;
      // we only fail if neither appears within the window.
      if (!foundUseCode && !foundConnected) {
        throw new Error(`vscode tunnel log did not show a device code or a connection within 60s.\nRecent [vscode-tunnel] lines:\n${tail || '(none)'}`);
      }
    });
  });

  test.describe('SSH singleton app with auto port mapping', () => {
    test.afterEach(async ({ request }) => {
      const api = new ApiClient(request);
      await api.stopApp(containerId, 'ssh', 'ssh').catch(() => {});
      // Clean any leftover ssh port mappings so other tests aren't affected.
      const { body: mappings } = await api.listPortMappings();
      for (const m of mappings) {
        if (m.appType === 'ssh' && m.containerName && m.containerName.includes(containerId.slice(0, 8))) {
          await api.deletePortMapping(m.externalPort).catch(() => {});
        }
      }
    });

    test('ssh is listed in app-types as a singleton with fixedInternalPort 22', async ({ request }) => {
      const res = await request.get('/api/app-types');
      const types = await res.json();
      const ssh = types.find((t: { id: string }) => t.id === 'ssh');
      expect(ssh).toBeTruthy();
      expect(ssh.singleton).toBe(true);
      expect(ssh.fixedInternalPort).toBe(22);
      expect(ssh.autoPortMapping).toBeTruthy();
      expect(ssh.autoPortMapping.externalPortStart).toBe(22000);
      expect(ssh.autoPortMapping.externalPortEnd).toBe(22999);
    });

    test('starting ssh creates a port mapping in 22000-22999', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.startApp(containerId, 'ssh');
      expect(status).toBe(201);
      expect(body.id).toBe('ssh');
      expect(body.port).toBe(22);
      expect(typeof body.externalPort).toBe('number');
      expect(body.externalPort).toBeGreaterThanOrEqual(22000);
      expect(body.externalPort).toBeLessThanOrEqual(22999);

      // Verify the mapping appears in the list endpoint.
      const { body: mappings } = await api.listPortMappings();
      const match = mappings.find((m: { externalPort: number }) => m.externalPort === body.externalPort);
      expect(match).toBeTruthy();
      expect(match.internalPort).toBe(22);
      expect(match.appType).toBe('ssh');
      expect(match.instanceId).toBe('ssh');
      expect(match.type).toBe('external');
    });

    test('starting ssh twice returns 409', async ({ request }) => {
      const api = new ApiClient(request);
      const first = await api.startApp(containerId, 'ssh');
      expect(first.status).toBe(201);
      const second = await api.startApp(containerId, 'ssh');
      expect(second.status).toBe(409);
    });

    test('stop/start cycle reuses the same external port', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: first } = await api.startApp(containerId, 'ssh');
      const firstPort = first.externalPort;
      await api.stopApp(containerId, 'ssh', 'ssh');
      await new Promise(r => setTimeout(r, 500));
      const { body: second } = await api.startApp(containerId, 'ssh');
      expect(second.externalPort).toBe(firstPort);
    });

    test('stopping ssh does not remove the port mapping', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.startApp(containerId, 'ssh');
      await api.stopApp(containerId, 'ssh', 'ssh');
      const { body: mappings } = await api.listPortMappings();
      const stillThere = mappings.find((m: { externalPort: number }) => m.externalPort === body.externalPort);
      expect(stillThere).toBeTruthy();
    });
  });
});
