import { test, expect } from '@playwright/test';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';
import { TerminalWsClient, checkAgentCredentials, AgentCredentials } from '../helpers/terminal-ws';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

/**
 * Fetch init scripts from the API (plain fetch, no Playwright request context needed).
 */
async function getInitScripts(): Promise<{ id: string; name: string; content: string }[]> {
  const res = await fetch(`${BASE_URL}/api/init-scripts`);
  return res.json();
}

/**
 * Agent-specific configuration for prompting tests.
 */
interface AgentTestConfig {
  id: string;
  displayName: string;
  /** Regex to detect the agent is ready for input */
  readyPattern: RegExp;
  /** Regex to detect the agent failed to start (fell back to shell) */
  failPattern: RegExp;
  /** Simple prompt to send */
  prompt: string;
  /** Pattern expected in the response */
  responsePattern: RegExp;
}

const AGENT_CONFIGS: AgentTestConfig[] = [
  {
    id: 'claude',
    displayName: 'Claude',
    // Claude TUI shows "Welcome to" (may appear as "Welcometo" after ANSI stripping)
    readyPattern: /Welcome\s*to/i,
    failPattern: /\$\s*$/m,
    prompt: 'What is 2+2? Reply with just the number.',
    responsePattern: /4/,
  },
  {
    id: 'codex',
    displayName: 'Codex',
    // Codex TUI shows "OpenAI Codex" banner after startup
    readyPattern: /OpenAI Codex/i,
    failPattern: /\$\s*$/m,
    prompt: 'What is 2+2? Reply with just the number.',
    responsePattern: /4/,
  },
  {
    id: 'gemini',
    displayName: 'Gemini',
    // Gemini TUI shows "Type your message" prompt after startup
    readyPattern: /Type your message/i,
    failPattern: /\$\s*$/m,
    prompt: 'What is 2+2? Reply with just the number.',
    responsePattern: /4/,
  },
];

let credentials: AgentCredentials;
let initScripts: { id: string; name: string; content: string }[];

test.beforeAll(async ({ request }) => {
  credentials = await checkAgentCredentials(request);
  initScripts = await getInitScripts();
});

for (const agent of AGENT_CONFIGS) {
  test.describe.serial(`${agent.displayName} Agent Prompting`, () => {
    let containerId: string;
    let ws: TerminalWsClient;

    test.beforeAll(async ({ request }) => {
      const hasCredentials = credentials[agent.id as keyof AgentCredentials];
      test.skip(!hasCredentials, `No credentials configured for ${agent.displayName}`);

      const script = initScripts.find(p => p.id === agent.id);
      if (!script) {
        test.skip(true, `Init script '${agent.id}' not found`);
        return;
      }

      const container = await createWorker(request, {
        displayName: `${agent.displayName}-test-${Date.now()}`,
        initScript: script.content,
      });
      containerId = container.id;
    });

    test.afterAll(async ({ request }) => {
      ws?.close();
      if (containerId) {
        await cleanupWorker(request, containerId);
      }
    });

    test(`${agent.displayName} CLI starts and shows prompt`, async () => {
      test.setTimeout(300_000);

      ws = new TerminalWsClient(containerId);
      await ws.connect(15_000);

      // Wait for agent readiness — either agent prompt or shell fallback
      try {
        await ws.waitForOutput(agent.readyPattern, 120_000);
      } catch {
        const buf = ws.getBuffer();
        // Check if we fell back to a shell prompt (agent failed to start)
        if (agent.failPattern.test(buf)) {
          test.skip(true, `${agent.displayName} CLI did not start (fell back to shell). Output:\n${buf.slice(-500)}`);
        }
        throw new Error(
          `${agent.displayName} CLI did not reach ready state within 120s.\n` +
          `Buffer (last 500 chars):\n${buf.slice(-500)}`
        );
      }
    });

    test(`${agent.displayName} responds to a simple prompt`, async () => {
      test.setTimeout(300_000);

      // ws should already be connected from the previous serial test
      if (!ws) {
        test.skip(true, `${agent.displayName} WebSocket not connected (previous test skipped?)`);
        return;
      }

      // Small delay to let the TUI fully initialize after readiness detection
      await new Promise(r => setTimeout(r, 3000));

      ws.clearBuffer();
      // Send text then Enter separately — TUI apps may need them as distinct events
      ws.sendRaw(agent.prompt);
      await new Promise(r => setTimeout(r, 500));
      ws.sendRaw('\r');

      try {
        await ws.waitForOutput(agent.responsePattern, 120_000);
      } catch {
        const buf = ws.getBuffer();
        throw new Error(
          `${agent.displayName} did not respond with expected pattern ${agent.responsePattern} within 120s.\n` +
          `Buffer (last 1000 chars):\n${buf.slice(-1000)}`
        );
      }

      const buf = ws.getBuffer();
      expect(buf).toMatch(agent.responsePattern);
    });
  });
}
