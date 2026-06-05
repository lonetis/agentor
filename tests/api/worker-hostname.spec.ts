import { test, expect } from '@playwright/test';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';
import { TerminalWsClient } from '../helpers/terminal-ws';

/**
 * Worker identity:
 * - `id` is the worker's stable UUID v4 (the resource identity, used in every
 *   `/api/containers/:id` route, unchanged across rebuild/unarchive).
 * - `containerId` is the current Docker container ID (changes on rebuild).
 * - `containerName` is `<containerPrefix>-<id>`.
 * - No custom hostname is set, so Docker defaults the in-container `hostname` to
 *   the short container id (the first 12 chars of `containerId`).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test.describe('worker identity & default hostname', () => {
  async function readHostname(containerId: string): Promise<string> {
    const ws = new TerminalWsClient(containerId);
    try {
      await ws.connect();
      await ws.waitForOutput(/[\$#>]\s*$/, 15_000);
      ws.clearBuffer();
      const tag = `HN${Date.now().toString(36)}`;
      ws.sendLine(`printf 'A_${tag}_%s_${tag}_Z\\n' "$(hostname)"`);
      const pattern = new RegExp(`A_${tag}_([^_]+)_${tag}_Z`);
      await ws.waitForOutput(pattern, 15_000);
      const buf = ws.getBuffer();
      const matches = [...buf.matchAll(new RegExp(`A_${tag}_([a-z0-9-]+)_${tag}_Z`, 'g'))];
      if (matches.length === 0) {
        throw new Error(`could not find hostname sentinel in:\n${buf.slice(-500)}`);
      }
      return matches[matches.length - 1][1];
    } finally {
      ws.close();
    }
  }

  test('auto-generated worker: id is a UUID, hostname is the docker short id', async ({ request }) => {
    const worker = await createWorker(request);
    try {
      expect(worker.id).toBeTruthy();
      expect(worker.id).toMatch(UUID);
      // containerName is `<prefix>-<id>` with no doubled prefix.
      expect(worker.containerName).toBe(`agentor-worker-${worker.id}`);
      expect(worker.containerName).not.toContain('agentor-worker-agentor-worker');
      // containerId is the Docker container id (64 hex), distinct from the worker id.
      expect(typeof worker.containerId).toBe('string');
      expect(worker.containerId).toMatch(/^[0-9a-f]{12,}$/);

      // The default hostname is the short container id (first 12 chars of containerId).
      const hostname = await readHostname(worker.id as string);
      expect(hostname).toBe((worker.containerId as string).slice(0, 12));
    } finally {
      await cleanupWorker(request, worker.id as string);
    }
  });

  test('custom display name: id is still a UUID, displayName is the label', async ({ request }) => {
    const worker = await createWorker(request, { displayName: 'my-custom-label' });
    try {
      expect(worker.displayName).toBe('my-custom-label');
      expect(worker.id).toMatch(UUID);
      expect(worker.id).not.toBe('my-custom-label');
      expect(worker.containerName).toBe(`agentor-worker-${worker.id}`);
      expect(worker.containerName).not.toContain('agentor-worker-agentor-worker');

      const hostname = await readHostname(worker.id as string);
      expect(hostname).toBe((worker.containerId as string).slice(0, 12));
    } finally {
      await cleanupWorker(request, worker.id as string);
    }
  });
});
