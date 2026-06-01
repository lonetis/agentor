import { test, expect } from '@playwright/test';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';
import { TerminalWsClient } from '../helpers/terminal-ws';

/**
 * Worker identity: the worker's `name` is now an opaque, server-minted UUID v4
 * that doubles as the container Hostname. The in-container `hostname` command
 * therefore returns the UUID — never a friendly slug or the editable
 * `displayName`. `containerName` is `<containerPrefix>-<name>` (no userId
 * segment) so it ends with `-<uuid>` and never contains a doubled prefix.
 */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test.describe('worker hostname is the UUID name', () => {
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

  test('auto-generated worker: hostname equals the UUID name', async ({ request }) => {
    const worker = await createWorker(request);
    try {
      expect(worker.name).toBeTruthy();
      expect(typeof worker.name).toBe('string');
      // `name` is a server-minted UUID v4.
      expect(worker.name).toMatch(UUID_V4);
      // containerName ends with `-<uuid>` and has no doubled prefix.
      expect(worker.containerName).toMatch(new RegExp(`-${worker.name}$`));
      expect(worker.containerName).not.toContain('agentor-worker-agentor-worker');

      const hostname = await readHostname(worker.id as string);
      expect(hostname).toBe(worker.name);
    } finally {
      await cleanupWorker(request, worker.id as string);
    }
  });

  test('custom display name: hostname is still the UUID, displayName is the label', async ({ request }) => {
    const worker = await createWorker(request, { displayName: 'my-custom-label' });
    try {
      // The user-facing label is the displayName...
      expect(worker.displayName).toBe('my-custom-label');
      // ...while `name` remains a server-minted UUID, distinct from the label.
      expect(worker.name).toMatch(UUID_V4);
      expect(worker.name).not.toBe('my-custom-label');
      // containerName is still `<prefix>-<uuid>`.
      expect(worker.containerName).toMatch(new RegExp(`-${worker.name}$`));
      expect(worker.containerName).not.toContain('agentor-worker-agentor-worker');

      const hostname = await readHostname(worker.id as string);
      expect(hostname).toBe(worker.name);
    } finally {
      await cleanupWorker(request, worker.id as string);
    }
  });
});
