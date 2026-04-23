import { test, expect } from '@playwright/test';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';
import { TerminalWsClient } from '../helpers/terminal-ws';

/**
 * Regression: the Create Worker UI used to prepend `agentor-worker-` to any
 * custom name, so a worker the user named `pocs` ended up with hostname
 * `agentor-worker-pocs` and a double-prefixed Docker container name. The
 * hostname a user sees in the worker's shell must match the `name` they
 * typed (or the auto-generated slug).
 */
test.describe('worker hostname matches name', () => {
  async function readHostname(containerId: string): Promise<string> {
    const ws = new TerminalWsClient(containerId);
    try {
      await ws.connect();
      await ws.waitForOutput(/[\$#>]\s*$/, 15_000);
      ws.clearBuffer();
      // Wrap the hostname in distinctive sentinels so we can extract it cleanly
      // from the buffer (which also contains the echoed command and the prompt).
      const tag = `HN${Date.now().toString(36)}`;
      ws.sendLine(`printf 'A_${tag}_%s_${tag}_Z\\n' "$(hostname)"`);
      const pattern = new RegExp(`A_${tag}_([^_]+)_${tag}_Z`);
      await ws.waitForOutput(pattern, 15_000);
      const buf = ws.getBuffer();
      // Match against the portion of the buffer that comes AFTER the last
      // occurrence of the printf echo — that way we never pick up the command
      // line itself (which contains the literal sentinel in `$(hostname)` form,
      // not the substituted value).
      const matches = [...buf.matchAll(new RegExp(`A_${tag}_([a-z0-9-]+)_${tag}_Z`, 'g'))];
      if (matches.length === 0) {
        throw new Error(`could not find hostname sentinel in:\n${buf.slice(-500)}`);
      }
      return matches[matches.length - 1][1];
    } finally {
      ws.close();
    }
  }

  test('auto-generated worker: hostname equals name', async ({ request }) => {
    const worker = await createWorker(request);
    try {
      expect(worker.name).toBeTruthy();
      expect(typeof worker.name).toBe('string');
      // Auto-generated names are two words joined by a hyphen — no prefix.
      expect(worker.name).not.toMatch(/^agentor-worker-/);

      const hostname = await readHostname(worker.id as string);
      expect(hostname).toBe(worker.name);
    } finally {
      await cleanupWorker(request, worker.id as string);
    }
  });

  test('custom worker name: hostname equals the custom name, no prefix added', async ({ request }) => {
    const shortId = Math.random().toString(36).slice(2, 8);
    const customName = `pocs-${shortId}`;

    const worker = await createWorker(request, { name: customName });
    try {
      expect(worker.name).toBe(customName);
      // Docker container name must be `<prefix>-<userId>-<name>` — i.e. end with
      // exactly one occurrence of `-<customName>`, with no extra `agentor-worker-`
      // segment between the userId and the name.
      expect(worker.containerName).toMatch(new RegExp(`-${customName}$`));
      expect(worker.containerName).not.toMatch(new RegExp(`-agentor-worker-${customName}$`));

      const hostname = await readHostname(worker.id as string);
      expect(hostname).toBe(customName);
    } finally {
      await cleanupWorker(request, worker.id as string);
    }
  });
});
