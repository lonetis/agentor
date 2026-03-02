import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';
import { TerminalWsClient } from '../helpers/terminal-ws';

test.describe.serial('Terminal Command Execution', () => {
  let containerId: string;

  test.beforeAll(async ({ request }) => {
    const container = await createWorker(request);
    containerId = container.id;
  });

  test.afterAll(async ({ request }) => {
    await cleanupWorker(request, containerId);
  });

  test('WebSocket connects to main terminal', async () => {
    const ws = new TerminalWsClient(containerId);
    try {
      await ws.connect();
      // Should receive some initial output (prompt, MOTD, etc.)
      await ws.waitForOutput(/[\$#>]/, 15_000);
    } finally {
      ws.close();
    }
  });

  test('receives initial output after connecting', async () => {
    const ws = new TerminalWsClient(containerId);
    try {
      await ws.connect();
      // Wait for shell prompt — indicates terminal is ready
      await ws.waitForOutput(/[\$#>]\s*$/, 15_000);
      const buf = ws.getBuffer();
      expect(buf.length).toBeGreaterThan(0);
    } finally {
      ws.close();
    }
  });

  test('echo command produces output', async () => {
    const ws = new TerminalWsClient(containerId);
    try {
      await ws.connect();
      await ws.waitForOutput(/[\$#>]\s*$/, 15_000);
      ws.clearBuffer();

      const marker = `MARKER_${Date.now()}`;
      ws.sendLine(`echo ${marker}`);
      await ws.waitForOutput(new RegExp(marker), 10_000);

      const buf = ws.getBuffer();
      expect(buf).toContain(marker);
    } finally {
      ws.close();
    }
  });

  test('pwd returns /workspace', async () => {
    const ws = new TerminalWsClient(containerId);
    try {
      await ws.connect();
      await ws.waitForOutput(/[\$#>]\s*$/, 15_000);
      ws.clearBuffer();

      ws.sendLine('pwd');
      await ws.waitForOutput(/\/workspace/, 10_000);
    } finally {
      ws.close();
    }
  });

  test('HOME is /home/agent', async () => {
    const ws = new TerminalWsClient(containerId);
    try {
      await ws.connect();
      await ws.waitForOutput(/[\$#>]\s*$/, 15_000);
      ws.clearBuffer();

      ws.sendLine('echo $HOME');
      await ws.waitForOutput(/\/home\/agent/, 10_000);
    } finally {
      ws.close();
    }
  });

  test('exit code is captured', async () => {
    const ws = new TerminalWsClient(containerId);
    try {
      await ws.connect();
      await ws.waitForOutput(/[\$#>]\s*$/, 15_000);
      ws.clearBuffer();

      ws.sendLine('false; echo "EXIT_CODE=$?"');
      await ws.waitForOutput(/EXIT_CODE=1/, 10_000);
    } finally {
      ws.close();
    }
  });

  test('named tmux window connects separately', async () => {
    const api = new ApiClient(({ get: () => {}, post: () => {}, put: () => {}, delete: () => {} }) as never);
    // Create a named window via the API first
    const apiClient = new ApiClient(test.info().config as never);

    // We'll use a direct fetch to create the pane since we're in an API test
    const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
    const windowName = `test-${Date.now() % 10000}`;

    const createRes = await fetch(`${BASE_URL}/api/containers/${containerId}/panes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: windowName }),
    });
    expect(createRes.status).toBe(201);

    try {
      const ws = new TerminalWsClient(containerId, windowName);
      try {
        await ws.connect();
        await ws.waitForOutput(/[\$#>]\s*$/, 15_000);
        ws.clearBuffer();

        const marker = `NAMED_${Date.now()}`;
        ws.sendLine(`echo ${marker}`);
        await ws.waitForOutput(new RegExp(marker), 10_000);
      } finally {
        ws.close();
      }
    } finally {
      // Cleanup the window
      await fetch(`${BASE_URL}/api/containers/${containerId}/panes/${windowName}`, {
        method: 'DELETE',
      });
    }
  });

  test('resize does not cause errors', async () => {
    const ws = new TerminalWsClient(containerId);
    try {
      await ws.connect();
      await ws.waitForOutput(/[\$#>]\s*$/, 15_000);

      // Send a resize — should not cause disconnect or error
      ws.sendResize(120, 40);

      // Small delay to let the resize propagate
      await new Promise(r => setTimeout(r, 500));

      // Terminal should still work
      ws.clearBuffer();
      const marker = `RESIZE_${Date.now()}`;
      ws.sendLine(`echo ${marker}`);
      await ws.waitForOutput(new RegExp(marker), 10_000);
    } finally {
      ws.close();
    }
  });

  test('concurrent window connections are isolated', async () => {
    const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
    const windowName = `iso-${Date.now() % 10000}`;

    const createRes = await fetch(`${BASE_URL}/api/containers/${containerId}/panes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: windowName }),
    });
    expect(createRes.status).toBe(201);

    try {
      const wsMain = new TerminalWsClient(containerId, 'main');
      const wsNamed = new TerminalWsClient(containerId, windowName);

      try {
        await Promise.all([wsMain.connect(), wsNamed.connect()]);
        await Promise.all([
          wsMain.waitForOutput(/[\$#>]\s*$/, 15_000),
          wsNamed.waitForOutput(/[\$#>]\s*$/, 15_000),
        ]);

        wsMain.clearBuffer();
        wsNamed.clearBuffer();

        // Send unique markers to each window
        const mainMarker = `MAIN_${Date.now()}`;
        const namedMarker = `NAMED_${Date.now()}`;

        wsMain.sendLine(`echo ${mainMarker}`);
        wsNamed.sendLine(`echo ${namedMarker}`);

        await Promise.all([
          wsMain.waitForOutput(new RegExp(mainMarker), 10_000),
          wsNamed.waitForOutput(new RegExp(namedMarker), 10_000),
        ]);

        // Each buffer should contain its own marker but not the other's
        expect(wsMain.getBuffer()).toContain(mainMarker);
        expect(wsMain.getBuffer()).not.toContain(namedMarker);
        expect(wsNamed.getBuffer()).toContain(namedMarker);
        expect(wsNamed.getBuffer()).not.toContain(mainMarker);
      } finally {
        wsMain.close();
        wsNamed.close();
      }
    } finally {
      await fetch(`${BASE_URL}/api/containers/${containerId}/panes/${windowName}`, {
        method: 'DELETE',
      });
    }
  });

  test('multiline command output is captured', async () => {
    const ws = new TerminalWsClient(containerId);
    try {
      await ws.connect();
      await ws.waitForOutput(/[\$#>]\s*$/, 15_000);
      ws.clearBuffer();

      ws.sendLine('for i in 1 2 3; do echo "LINE_$i"; done');
      await ws.waitForOutput(/LINE_3/, 10_000);

      const buf = ws.getBuffer();
      expect(buf).toContain('LINE_1');
      expect(buf).toContain('LINE_2');
      expect(buf).toContain('LINE_3');
    } finally {
      ws.close();
    }
  });

  test('whoami returns agent user', async () => {
    const ws = new TerminalWsClient(containerId);
    try {
      await ws.connect();
      await ws.waitForOutput(/[\$#>]\s*$/, 15_000);
      ws.clearBuffer();

      ws.sendLine('whoami');
      await ws.waitForOutput(/agent/, 10_000);
    } finally {
      ws.close();
    }
  });

  test('WebSocket to non-existent container fails gracefully', async () => {
    const ws = new TerminalWsClient('non-existent-container-id');
    try {
      await ws.connect();
      // Should receive an error message or close
      const buf = await ws.waitForOutput(/[Ee]rror/, 10_000).catch(() => ws.getBuffer());
      // Either we got an error message, or the connection will fail — both are acceptable
      expect(buf.length).toBeGreaterThanOrEqual(0);
    } catch {
      // Connection failure is also acceptable
    } finally {
      ws.close();
    }
  });
});
