import { test, expect } from '@playwright/test';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';
import { TerminalWsClient } from '../helpers/terminal-ws';

/**
 * Verify MCP servers are configured correctly for each agent CLI.
 * - Claude: reads from ~/.claude.json (user scope); `claude mcp list` uses
 *   TUI rendering that can't be captured, so we verify via jq instead.
 * - Codex: `codex mcp list` produces plain text output — verify directly.
 * - Gemini: reads from ~/.gemini/settings.json; `gemini mcp list` produces
 *   no capturable output, so we verify via jq instead.
 */

async function execInWorker(containerId: string, command: string, timeoutMs = 30_000): Promise<string> {
  const ws = new TerminalWsClient(containerId);
  try {
    await ws.connect();
    await ws.waitForOutput(/[\$#>]\s*$/, 15_000);
    ws.clearBuffer();

    const marker = `__END_${Date.now()}__`;
    ws.sendLine(`${command}; echo ${marker}`);
    await ws.waitForOutput(new RegExp(marker), timeoutMs);

    return ws.getBuffer();
  } finally {
    ws.close();
  }
}

test.describe('MCP servers loaded by agent CLIs', () => {
  let containerId: string;

  test.beforeAll(async ({ request }) => {
    const container = await createWorker(request, { displayName: `MCP-verify-${Date.now()}` });
    containerId = container.id;
  });

  test.afterAll(async ({ request }) => {
    await cleanupWorker(request, containerId);
  });

  test('claude has playwright and chrome-devtools MCP servers in config', async () => {
    // claude mcp list uses TUI rendering — verify the config file directly
    const output = await execInWorker(containerId, 'jq -r ".mcpServers | keys[]" ~/.claude.json 2>&1');
    expect(output).toContain('playwright');
    expect(output).toContain('chrome-devtools');
  });

  test('claude MCP server entries have correct commands', async () => {
    const pw = await execInWorker(containerId, 'jq -r ".mcpServers.playwright.args[1]" ~/.claude.json');
    expect(pw).toContain('@playwright/mcp@latest');
    const cd = await execInWorker(containerId, 'jq -r ".mcpServers[\\"chrome-devtools\\"].args[1]" ~/.claude.json');
    expect(cd).toContain('chrome-devtools-mcp@latest');
  });

  test('codex mcp list shows playwright and chrome-devtools', async () => {
    const output = await execInWorker(containerId, 'codex mcp list 2>&1');
    expect(output).toContain('playwright');
    expect(output).toContain('chrome-devtools');
  });

  test('codex MCP servers are enabled', async () => {
    const output = await execInWorker(containerId, 'codex mcp list 2>&1');
    // codex mcp list shows Status column — both should be "enabled"
    const lines = output.split('\n').filter(l => l.includes('playwright') || l.includes('chrome-devtools'));
    for (const line of lines) {
      expect(line).toContain('enabled');
    }
  });

  test('gemini has playwright and chrome-devtools MCP servers in config', async () => {
    // gemini mcp list produces no capturable terminal output — verify config directly
    const output = await execInWorker(containerId, 'jq -r ".mcpServers | keys[]" ~/.gemini/settings.json 2>&1');
    expect(output).toContain('playwright');
    expect(output).toContain('chrome-devtools');
  });

  test('gemini MCP server entries have correct commands', async () => {
    const pw = await execInWorker(containerId, 'jq -r ".mcpServers.playwright.args[1]" ~/.gemini/settings.json');
    expect(pw).toContain('@playwright/mcp@latest');
    const cd = await execInWorker(containerId, 'jq -r ".mcpServers[\\"chrome-devtools\\"].args[1]" ~/.gemini/settings.json');
    expect(cd).toContain('chrome-devtools-mcp@latest');
  });
});
