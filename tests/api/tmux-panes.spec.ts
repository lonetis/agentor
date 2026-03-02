import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';

test.describe('Tmux Panes API', () => {
  let containerId: string;

  test.beforeAll(async ({ request }) => {
    const container = await createWorker(request);
    containerId = container.id;
  });

  test.afterAll(async ({ request }) => {
    await cleanupWorker(request, containerId);
  });

  test.describe('GET /api/containers/:id/panes', () => {
    test('lists tmux windows', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.listPanes(containerId);
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);
      // Should always have a main window
      const mainWindow = body.find((w: { name: string }) => w.name === 'main');
      expect(mainWindow).toBeTruthy();
    });

    test('each window has required fields', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.listPanes(containerId);
      for (const window of body) {
        expect(typeof window.index).toBe('number');
        expect(typeof window.name).toBe('string');
        expect(typeof window.active).toBe('boolean');
      }
    });
  });

  test.describe('POST /api/containers/:id/panes', () => {
    test('creates a new tmux window with a name', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.createPane(containerId, 'test-window');
      expect(status).toBe(201);
      expect(body.windowName).toBe('test-window');

      // Verify it exists
      const { body: panes } = await api.listPanes(containerId);
      expect(panes.some((w: { name: string }) => w.name === 'test-window')).toBe(true);

      // Cleanup
      await api.deletePane(containerId, 'test-window');
    });

    test('creates a window without a name (auto-generated)', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.createPane(containerId);
      expect(status).toBe(201);
      expect(body.windowName).toBeTruthy();

      // Cleanup
      await api.deletePane(containerId, body.windowName);
    });

    test('rejects invalid window name with special chars', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createPane(containerId, 'invalid name!');
      expect(status).toBe(400);
    });

    test('rejects window name with spaces', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createPane(containerId, 'has spaces');
      expect(status).toBe(400);
    });

    test('rejects window name with dots', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createPane(containerId, 'has.dot');
      expect(status).toBe(400);
    });

    test('accepts alphanumeric window name', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.createPane(containerId, 'test123');
      expect(status).toBe(201);
      await api.deletePane(containerId, body.windowName);
    });

    test('accepts window name with dashes', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.createPane(containerId, 'my-window');
      expect(status).toBe(201);
      await api.deletePane(containerId, body.windowName);
    });

    test('accepts window name with underscores', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.createPane(containerId, 'my_window');
      expect(status).toBe(201);
      await api.deletePane(containerId, body.windowName);
    });

    test('handles duplicate window name gracefully', async ({ request }) => {
      const api = new ApiClient(request);
      const windowName = `dup-${Date.now()}`;
      const { status: firstStatus, body: first } = await api.createPane(containerId, windowName);
      expect(firstStatus).toBe(201);

      try {
        // Second creation with same name succeeds (tmux allows duplicate names)
        const { status: secondStatus, body: second } = await api.createPane(containerId, windowName);
        expect(secondStatus).toBe(201);
        expect(second.windowName).toBe(windowName);
        await api.deletePane(containerId, second.windowName);
      } finally {
        await api.deletePane(containerId, first.windowName);
      }
    });
  });

  test.describe('PUT /api/containers/:id/panes/:windowName', () => {
    test('renames a tmux window', async ({ request }) => {
      const api = new ApiClient(request);
      // Create a window to rename
      const { body: created } = await api.createPane(containerId, 'rename-me');

      const { status, body } = await api.renamePane(containerId, created.windowName, 'renamed');
      expect(status).toBe(200);
      expect(body.windowName).toBe('renamed');

      // Cleanup
      await api.deletePane(containerId, 'renamed');
    });

    test('rejects empty newName', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: created } = await api.createPane(containerId, 'rename-test');

      const { status } = await api.renamePane(containerId, created.windowName, '');
      expect(status).toBe(400);

      await api.deletePane(containerId, created.windowName);
    });

    test('rejects invalid newName', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: created } = await api.createPane(containerId, 'rename-test2');

      const { status } = await api.renamePane(containerId, created.windowName, 'bad name!');
      expect(status).toBe(400);

      await api.deletePane(containerId, created.windowName);
    });

    test('rename preserves window in list', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: created } = await api.createPane(containerId, 'rename-verify');
      await api.renamePane(containerId, created.windowName, 'renamed-verified');

      const { body: panes } = await api.listPanes(containerId);
      expect(panes.some((w: { name: string }) => w.name === 'renamed-verified')).toBe(true);
      expect(panes.some((w: { name: string }) => w.name === 'rename-verify')).toBe(false);

      await api.deletePane(containerId, 'renamed-verified');
    });
  });

  test.describe('DELETE /api/containers/:id/panes/:windowName', () => {
    test('closes a tmux window', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: created } = await api.createPane(containerId, 'close-me');

      const { status, body } = await api.deletePane(containerId, created.windowName);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);

      // Verify it's gone
      const { body: panes } = await api.listPanes(containerId);
      expect(panes.some((w: { name: string }) => w.name === 'close-me')).toBe(false);
    });

    test('cannot close the main window', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.deletePane(containerId, 'main');
      expect(status).toBe(403);
    });

    test('rejects invalid window name in URL', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.deletePane(containerId, 'bad name!');
      expect(status).toBe(400);
    });
  });

  test.describe('Edge cases', () => {
    test('creating pane with whitespace-only name auto-generates', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.createPane(containerId, '   ');
      expect(status).toBe(201);
      expect(body.windowName).toBeTruthy();
      await api.deletePane(containerId, body.windowName);
    });

    test('listing panes on non-existent container fails', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.listPanes('non-existent-id');
      expect(status).toBeGreaterThanOrEqual(400);
    });

    test('creating pane on non-existent container fails', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createPane('non-existent-id', 'test');
      expect(status).toBeGreaterThanOrEqual(400);
    });

    test('auto-generated name follows shell-XXXX pattern', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.createPane(containerId);
      expect(body.windowName).toMatch(/^shell-[a-zA-Z0-9]{4}$/);
      await api.deletePane(containerId, body.windowName);
    });

    test('rename non-existent window is idempotent', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.renamePane(containerId, 'no-such-window', 'new-name');
      // tmux rename on non-existent window returns 200 (silent no-op)
      expect(status).toBe(200);
    });

    test('delete non-existent window is idempotent', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.deletePane(containerId, 'no-such-window');
      // tmux kill-window on non-existent window returns 200 (silent no-op)
      expect(status).toBe(200);
    });

    test('main window always present in list', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.listPanes(containerId);
      const mainWindow = body.find((w: { name: string }) => w.name === 'main');
      expect(mainWindow).toBeTruthy();
      expect(typeof mainWindow.index).toBe('number');
    });

    test('rename second window to same name as first (tmux allows duplicates)', async ({ request }) => {
      const api = new ApiClient(request);
      const firstName = `dup-src-${Date.now()}`;
      const secondName = `dup-tgt-${Date.now()}`;

      const { body: first } = await api.createPane(containerId, firstName);
      const { body: second } = await api.createPane(containerId, secondName);

      // Rename second window to first's name — tmux allows duplicate names
      const { status } = await api.renamePane(containerId, second.windowName, firstName);
      expect(status).toBe(200);

      // Verify both windows exist with the same name
      const { body: panes } = await api.listPanes(containerId);
      const matching = panes.filter((w: { name: string }) => w.name === firstName);
      expect(matching.length).toBe(2);

      // Cleanup — delete by name (will delete one of the duplicates)
      await api.deletePane(containerId, firstName);
      await api.deletePane(containerId, firstName);
    });

    test('create window with 50-char valid name', async ({ request }) => {
      const api = new ApiClient(request);
      const longName = 'a'.repeat(50);
      const { status, body } = await api.createPane(containerId, longName);
      expect(status).toBe(201);
      expect(body.windowName).toBe(longName);

      await api.deletePane(containerId, body.windowName);
    });

    test('rejects rename with missing newName in body', async ({ request }) => {
      const api = new ApiClient(request);
      const windowName = `no-newname-${Date.now()}`;
      const { body: created } = await api.createPane(containerId, windowName);

      try {
        // Send body without newName — handler coerces missing to ''
        const res = await request.put(
          `${api.baseUrl}/api/containers/${containerId}/panes/${created.windowName}`,
          { data: {} },
        );
        expect(res.status()).toBe(400);
      } finally {
        await api.deletePane(containerId, created.windowName);
      }
    });

    test('rename main window behavior', async ({ request }) => {
      const api = new ApiClient(request);
      const newName = `main-renamed-${Date.now()}`;
      const { status } = await api.renamePane(containerId, 'main', newName);

      if (status === 200) {
        // If rename succeeded, rename it back to restore state
        await api.renamePane(containerId, newName, 'main');
      } else {
        // If rename is forbidden or fails, that's also valid behavior
        expect(status).toBeGreaterThanOrEqual(400);
      }
    });
  });
});
