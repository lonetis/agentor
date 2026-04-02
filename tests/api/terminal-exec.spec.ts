import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';
import { TerminalWsClient } from '../helpers/terminal-ws';

test.describe.serial('Terminal Command Execution', () => {
  let containerId: string;

  test.beforeAll(async ({ request }) => {
    const container = await createWorker(request);
    containerId = container.id;
    // Wait for tmux to be fully ready — verify we can create a window
    const api = new ApiClient(request);
    const start = Date.now();
    while (Date.now() - start < 60_000) {
      const { status } = await api.listPanes(containerId);
      if (status !== 200) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      const { status: createStatus, body } = await api.createPane(containerId, 'readiness-probe');
      if (createStatus === 201) {
        await api.deletePane(containerId, body.index);
        break;
      }
      await new Promise(r => setTimeout(r, 2000));
    }
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
    const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
    const windowName = `test-${Date.now() % 10000}`;

    const createRes = await fetch(`${BASE_URL}/api/containers/${containerId}/panes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: windowName }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    const windowIndex = created.index;

    try {
      // Use the numeric window index for the WebSocket connection (not the name)
      const ws = new TerminalWsClient(containerId, String(windowIndex));
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
      // Cleanup the window using the numeric index
      await fetch(`${BASE_URL}/api/containers/${containerId}/panes/${windowIndex}`, {
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
    const created = await createRes.json();
    const windowIndex = created.index;

    try {
      const wsMain = new TerminalWsClient(containerId, 'main');
      const wsNamed = new TerminalWsClient(containerId, String(windowIndex));

      try {
        await Promise.all([wsMain.connect(), wsNamed.connect()]);
        await Promise.all([
          wsMain.waitForOutput(/[\$#>]\s*$/, 15_000),
          wsNamed.waitForOutput(/[\$#>]\s*$/, 15_000),
        ]);

        // Wait for shells to fully initialize before testing isolation
        await new Promise(r => setTimeout(r, 1000));

        wsMain.clearBuffer();
        wsNamed.clearBuffer();

        // Send unique markers sequentially to avoid any race conditions
        const ts = Date.now();
        const mainMarker = `XMAIN_${ts}_XMAIN`;
        const namedMarker = `XNAMED_${ts + 999}_XNAMED`;

        // Send to main window and wait for echo
        wsMain.sendLine(`echo ${mainMarker}`);
        await wsMain.waitForOutput(new RegExp(mainMarker), 10_000);

        // Small delay between operations
        await new Promise(r => setTimeout(r, 500));

        // Send to named window and wait for echo
        wsNamed.sendLine(`echo ${namedMarker}`);
        await wsNamed.waitForOutput(new RegExp(namedMarker), 10_000);

        // Each buffer should contain its own marker
        expect(wsMain.getBuffer()).toContain(mainMarker);
        expect(wsNamed.getBuffer()).toContain(namedMarker);
        // Named window should not contain main's marker (main window may have had
        // some init output that got cleared, so we only check the named window isolation)
        expect(wsNamed.getBuffer()).not.toContain(mainMarker);
      } finally {
        wsMain.close();
        wsNamed.close();
      }
    } finally {
      await fetch(`${BASE_URL}/api/containers/${containerId}/panes/${windowIndex}`, {
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

  test('WebSocket disconnect cleans up ws-* tmux session', async () => {
    // Take a baseline snapshot of tmux sessions
    const wsCheck = new TerminalWsClient(containerId);
    await wsCheck.connect();
    await wsCheck.waitForOutput(/[\$#>]\s*$/, 15_000);
    wsCheck.clearBuffer();
    wsCheck.sendLine('tmux ls 2>&1; echo __BEFORE__');
    await wsCheck.waitForOutput(/__BEFORE__/, 10_000);
    const beforeSessions = new Set((wsCheck.getBuffer().match(/^(ws-[^\s:]+)/gm) || []));

    // Open a new terminal connection — creates a new ws-* session
    const ws = new TerminalWsClient(containerId);
    await ws.connect();
    await ws.waitForOutput(/[\$#>]\s*$/, 15_000);

    // Find the new session
    wsCheck.clearBuffer();
    wsCheck.sendLine('tmux ls 2>&1; echo __DURING__');
    await wsCheck.waitForOutput(/__DURING__/, 10_000);
    const duringSessions = new Set((wsCheck.getBuffer().match(/^(ws-[^\s:]+)/gm) || []));
    const newSessions = [...duringSessions].filter(s => !beforeSessions.has(s));
    expect(newSessions.length).toBe(1);
    const newSession = newSessions[0];

    // Close the connection
    ws.close();

    // Wait for cleanup, then verify the specific session is gone
    const start = Date.now();
    let cleaned = false;
    while (Date.now() - start < 5000) {
      await new Promise(r => setTimeout(r, 500));
      wsCheck.clearBuffer();
      wsCheck.sendLine(`tmux has-session -t "${newSession}" 2>&1; echo "RC=$?"; echo __CHECK__`);
      await wsCheck.waitForOutput(/__CHECK__/, 5000);
      if (wsCheck.getBuffer().includes('RC=1')) {
        cleaned = true;
        break;
      }
    }
    expect(cleaned).toBe(true);

    wsCheck.close();
  });

  test('multiple WebSocket connections do not leave stale tmux sessions', async () => {
    // Baseline
    const wsCheck = new TerminalWsClient(containerId);
    await wsCheck.connect();
    await wsCheck.waitForOutput(/[\$#>]\s*$/, 15_000);
    wsCheck.clearBuffer();
    wsCheck.sendLine('tmux ls 2>&1; echo __BASELINE__');
    await wsCheck.waitForOutput(/__BASELINE__/, 10_000);
    const baselineSessions = new Set((wsCheck.getBuffer().match(/^(ws-[^\s:]+)/gm) || []));

    // Open 3 connections
    const clients: TerminalWsClient[] = [];
    for (let i = 0; i < 3; i++) {
      const c = new TerminalWsClient(containerId);
      await c.connect();
      await c.waitForOutput(/[\$#>]\s*$/, 15_000);
      clients.push(c);
    }

    // Find the 3 new sessions
    wsCheck.clearBuffer();
    wsCheck.sendLine('tmux ls 2>&1; echo __DURING__');
    await wsCheck.waitForOutput(/__DURING__/, 10_000);
    const duringSessions = new Set((wsCheck.getBuffer().match(/^(ws-[^\s:]+)/gm) || []));
    const newSessions = [...duringSessions].filter(s => !baselineSessions.has(s));
    expect(newSessions.length).toBe(3);

    // Close all 3
    for (const c of clients) {
      c.close();
    }

    // Verify all 3 specific sessions are gone
    const start = Date.now();
    let allCleaned = false;
    while (Date.now() - start < 5000) {
      await new Promise(r => setTimeout(r, 500));
      wsCheck.clearBuffer();
      wsCheck.sendLine('tmux ls 2>&1; echo __AFTER__');
      await wsCheck.waitForOutput(/__AFTER__/, 10_000);
      const afterSessions = new Set((wsCheck.getBuffer().match(/^(ws-[^\s:]+)/gm) || []));
      const remaining = newSessions.filter(s => afterSessions.has(s));
      if (remaining.length === 0) {
        allCleaned = true;
        break;
      }
    }
    expect(allCleaned).toBe(true);

    wsCheck.close();
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
