import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createWorker, cleanupWorker, waitForWorkerRunning } from '../helpers/worker-lifecycle';
import { TerminalWsClient } from '../helpers/terminal-ws';

/**
 * Helper: connect to terminal, wait for prompt, run a command, return output.
 *
 * The marker is anchored with newlines on both sides so it only matches
 * the OUTPUT of `echo`, never the shell's echo-back of the typed command
 * line (which has the marker preceded by a space). Without this anchor,
 * `waitForOutput` returns immediately when the command is typed, before
 * it has actually run.
 */
async function execInWorker(containerId: string, command: string, timeoutMs = 30_000): Promise<string> {
  const ws = new TerminalWsClient(containerId);
  try {
    await ws.connect();
    await ws.waitForOutput(/[\$#>]\s*$/, 30_000);
    ws.clearBuffer();

    const marker = `END_${Date.now()}_MK`;
    ws.sendLine(`${command}; echo ${marker}`);
    await ws.waitForOutput(new RegExp(`\\n${marker}\\n`), timeoutMs);

    return ws.getBuffer();
  } finally {
    ws.close();
  }
}

// -- Symlink and mount verification (single worker, serial) --

test.describe.serial('Agent data persistence — mount verification', () => {
  let containerId: string;

  test.beforeAll(async ({ request }) => {
    const container = await createWorker(request, { displayName: `AgentData-${Date.now()}` });
    containerId = container.id;
  });

  test.afterAll(async ({ request }) => {
    await cleanupWorker(request, containerId);
  });

  test('agent config dirs are symlinked to .agent-data volume', async () => {
    const output = await execInWorker(containerId, 'readlink ~/.claude && readlink ~/.gemini && readlink ~/.codex && readlink ~/.agents');
    expect(output).toContain('/home/agent/.agent-data/.claude');
    expect(output).toContain('/home/agent/.agent-data/.gemini');
    expect(output).toContain('/home/agent/.agent-data/.codex');
    expect(output).toContain('/home/agent/.agent-data/.agents');
  });

  test('~/.claude.json is symlinked to .agent-data volume', async () => {
    const output = await execInWorker(containerId, 'readlink ~/.claude.json');
    expect(output).toContain('/home/agent/.agent-data/.claude.json');
  });

  test('credential files are the per-user bind mount (regular files, not symlinks)', async () => {
    // Each credential file is bind-mounted from <DATA_DIR>/users/<userId>/credentials/<file>.json
    // directly at the CLI's expected path inside the agent-data volume. Writes go straight
    // to the host file and every worker the user owns sees the same credentials.
    const output = await execInWorker(
      containerId,
      'stat -c "%F" ~/.claude/.credentials.json ~/.codex/auth.json ~/.gemini/oauth_creds.json 2>/dev/null',
    );
    const lines = output.trim().split(/\r?\n/).filter(Boolean);
    expect(lines.length).toBe(3);
    for (const line of lines) {
      expect(line).toBe('regular file');
    }
  });

  test('claude settings.json exists with expected keys', async () => {
    const output = await execInWorker(containerId, 'cat ~/.claude/settings.json');
    expect(output).toContain('skipDangerousModePermissionPrompt');
    expect(output).toContain('bypassPermissions');
  });

  test('claude.json contains playwright MCP server', async () => {
    const output = await execInWorker(containerId, 'cat ~/.claude.json');
    expect(output).toContain('"playwright"');
    expect(output).toContain('@playwright/mcp@latest');
  });

  test('claude.json contains chrome-devtools MCP server', async () => {
    const output = await execInWorker(containerId, 'cat ~/.claude.json');
    expect(output).toContain('"chrome-devtools"');
    expect(output).toContain('chrome-devtools-mcp@latest');
  });

  test('claude.json exists with onboarding and trust keys', async () => {
    const output = await execInWorker(containerId, 'cat ~/.claude.json');
    expect(output).toContain('hasCompletedOnboarding');
    expect(output).toContain('/workspace');
  });

  test('codex config.toml exists with workspace trust', async () => {
    const output = await execInWorker(containerId, 'cat ~/.codex/config.toml');
    expect(output).toContain('trust_level');
    expect(output).toContain('/workspace');
  });

  test('codex config.toml contains playwright MCP server', async () => {
    const output = await execInWorker(containerId, 'cat ~/.codex/config.toml');
    expect(output).toContain('[mcp_servers.playwright]');
    expect(output).toContain('@playwright/mcp@latest');
  });

  test('codex config.toml contains chrome-devtools MCP server', async () => {
    const output = await execInWorker(containerId, 'cat ~/.codex/config.toml');
    expect(output).toContain('[mcp_servers.chrome-devtools]');
    expect(output).toContain('chrome-devtools-mcp@latest');
  });

  test('gemini trustedFolders.json exists with workspace trust', async () => {
    const output = await execInWorker(containerId, 'cat ~/.gemini/trustedFolders.json');
    expect(output).toContain('TRUST_FOLDER');
    expect(output).toContain('/workspace');
  });

  test('gemini settings.json contains playwright MCP server', async () => {
    const output = await execInWorker(containerId, 'cat ~/.gemini/settings.json');
    expect(output).toContain('playwright');
    expect(output).toContain('@playwright/mcp@latest');
  });

  test('gemini settings.json contains chrome-devtools MCP server', async () => {
    const output = await execInWorker(containerId, 'cat ~/.gemini/settings.json');
    expect(output).toContain('chrome-devtools');
    expect(output).toContain('chrome-devtools-mcp@latest');
  });
});

// -- Persistence across restart (serial, single worker) --

test.describe.serial('Agent data persistence — restart', () => {
  let containerId: string;
  const MARKER = `restart-persist-${Date.now()}`;

  test.beforeAll(async ({ request }) => {
    const container = await createWorker(request, { displayName: `Restart-${Date.now()}` });
    containerId = container.id;
  });

  test.afterAll(async ({ request }) => {
    await cleanupWorker(request, containerId);
  });

  test('write marker file to agent config dir', async () => {
    const output = await execInWorker(containerId, `echo "${MARKER}" > ~/.claude/test-marker.txt && cat ~/.claude/test-marker.txt`);
    expect(output).toContain(MARKER);
  });

  test('marker file persists after container restart', async ({ request }) => {
    const api = new ApiClient(request);
    await api.stopContainer(containerId);
    await new Promise(r => setTimeout(r, 2000));
    await api.restartContainer(containerId);
    await waitForWorkerRunning(request, containerId, 90_000);

    const output = await execInWorker(containerId, `cat ~/.claude/test-marker.txt`);
    expect(output).toContain(MARKER);
  });
});

// -- Persistence across rebuild (serial, single worker) --

test.describe.serial('Agent data persistence — rebuild', () => {
  let containerId: string;
  const MARKER = `rebuild-persist-${Date.now()}`;

  test.beforeAll(async ({ request }) => {
    const container = await createWorker(request, { displayName: `Rebuild-${Date.now()}` });
    containerId = container.id;
  });

  test.afterAll(async ({ request }) => {
    await cleanupWorker(request, containerId);
  });

  test('write marker file to agent config dir', async () => {
    const output = await execInWorker(containerId, `echo "${MARKER}" > ~/.gemini/test-marker.txt && cat ~/.gemini/test-marker.txt`);
    expect(output).toContain(MARKER);
  });

  test('marker file persists after container rebuild', async ({ request }) => {
    const api = new ApiClient(request);
    const { status, body } = await api.rebuildContainer(containerId);
    expect(status).toBe(200);
    containerId = body.id;

    await waitForWorkerRunning(request, containerId, 90_000);

    const output = await execInWorker(containerId, `cat ~/.gemini/test-marker.txt`);
    expect(output).toContain(MARKER);
  });
});

// -- Persistence across archive/unarchive (serial, single worker) --

test.describe.serial('Agent data persistence — archive/unarchive', () => {
  let containerId: string;
  let containerName: string;
  const MARKER = `archive-persist-${Date.now()}`;

  test.beforeAll(async ({ request }) => {
    const container = await createWorker(request, { displayName: `Archive-${Date.now()}` });
    containerId = container.id;
    containerName = container.name;
  });

  test.afterAll(async ({ request }) => {
    await cleanupWorker(request, containerId);
  });

  test('write marker file to agent config dir', async () => {
    const output = await execInWorker(containerId, `echo "${MARKER}" > ~/.codex/test-marker.txt && cat ~/.codex/test-marker.txt`);
    expect(output).toContain(MARKER);
  });

  test('marker file persists after archive and unarchive', async ({ request }) => {
    const api = new ApiClient(request);
    await api.archiveContainer(containerId);

    const { status, body } = await api.unarchiveWorker(containerName);
    expect(status).toBe(200);
    containerId = body.id;

    await waitForWorkerRunning(request, containerId, 90_000);

    const output = await execInWorker(containerId, `cat ~/.codex/test-marker.txt`);
    expect(output).toContain(MARKER);
  });
});

// -- Config files are NOT overwritten on restart/rebuild (serial, single worker) --

test.describe.serial('Agent data persistence — no overwrite', () => {
  let containerId: string;

  test.beforeAll(async ({ request }) => {
    const container = await createWorker(request, { displayName: `NoOverwrite-${Date.now()}` });
    containerId = container.id;
  });

  test.afterAll(async ({ request }) => {
    await cleanupWorker(request, containerId);
  });

  test('user modifications to settings.json are not overwritten on restart', async ({ request }) => {
    // Replace settings.json with custom content
    await execInWorker(containerId, 'echo \'{"custom":"user-owned"}\' > ~/.claude/settings.json');

    const api = new ApiClient(request);
    await api.stopContainer(containerId);
    await new Promise(r => setTimeout(r, 2000));
    await api.restartContainer(containerId);
    await waitForWorkerRunning(request, containerId, 90_000);

    // Setup script must NOT overwrite — file already existed
    const output = await execInWorker(containerId, 'cat ~/.claude/settings.json');
    expect(output).toContain('user-owned');
    expect(output).not.toContain('bypassPermissions');
  });

  test('user modifications to claude.json are not overwritten on restart', async ({ request }) => {
    // Replace claude.json with custom content (use cat > to write through symlink)
    await execInWorker(containerId, 'echo \'{"mcpServers":{"my-server":{"command":"test"}}}\' > ~/.claude.json');

    const api = new ApiClient(request);
    await api.stopContainer(containerId);
    await new Promise(r => setTimeout(r, 2000));
    await api.restartContainer(containerId);
    await waitForWorkerRunning(request, containerId, 90_000);

    const output = await execInWorker(containerId, 'cat ~/.claude.json');
    expect(output).toContain('mcpServers');
    expect(output).not.toContain('hasCompletedOnboarding');
  });

  test('user modifications to settings.json are not overwritten on rebuild', async ({ request }) => {
    // Write custom settings (previous test left custom claude.json)
    await execInWorker(containerId, 'echo \'{"rebuilt":"still-here"}\' > ~/.claude/settings.json');

    const api = new ApiClient(request);
    const { body } = await api.rebuildContainer(containerId);
    containerId = body.id;
    await waitForWorkerRunning(request, containerId, 90_000);

    const output = await execInWorker(containerId, 'cat ~/.claude/settings.json');
    expect(output).toContain('still-here');
    expect(output).not.toContain('bypassPermissions');
  });
});
