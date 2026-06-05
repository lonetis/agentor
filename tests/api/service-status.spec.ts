import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';

test.describe('Service Status API', () => {
  let containerId: string;

  test.beforeAll(async ({ request }) => {
    const container = await createWorker(request);
    containerId = container.id;
    // Wait a bit for services to start
    await new Promise(r => setTimeout(r, 5000));
  });

  test.afterAll(async ({ request }) => {
    await cleanupWorker(request, containerId);
  });

  test.describe('GET /api/containers/:id/desktop/status', () => {
    test('returns desktop service status', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.getDesktopStatus(containerId);
      expect(status).toBe(200);
      expect(typeof body.running).toBe('boolean');
    });
  });

  test.describe('GET /api/containers/:id/editor/status', () => {
    test('returns editor service status', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.getEditorStatus(containerId);
      expect(status).toBe(200);
      expect(typeof body.running).toBe('boolean');
    });
  });

  test.describe('Non-existent container', () => {
    test('desktop status returns 404 for non-existent container', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.getDesktopStatus('non-existent-id');
      expect(status).toBe(404);
    });

    test('editor status returns 404 for non-existent container', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.getEditorStatus('non-existent-id');
      expect(status).toBe(404);
    });
  });

  test.describe('Response fields', () => {
    // The route is addressed by the worker UUID `id`, but the status response's
    // `containerId` is the actual Docker container id (resolved server-side).
    async function workerDockerId(request: import('@playwright/test').APIRequestContext): Promise<string> {
      const { body: containers } = await new ApiClient(request).listContainers();
      return containers.find((c: { id: string }) => c.id === containerId).containerId;
    }

    test('desktop status includes the Docker containerId', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.getDesktopStatus(containerId);
      expect(typeof body.containerId).toBe('string');
      expect(body.containerId).toBe(await workerDockerId(request));
    });

    test('editor status includes the Docker containerId', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.getEditorStatus(containerId);
      expect(typeof body.containerId).toBe('string');
      expect(body.containerId).toBe(await workerDockerId(request));
    });
  });

  test.describe('Stopped container', () => {
    test('desktop status returns not running for stopped container', async ({ request }) => {
      const container = await createWorker(request);
      const api = new ApiClient(request);
      await api.stopContainer(container.id);
      await new Promise(r => setTimeout(r, 1000));

      const { status, body } = await api.getDesktopStatus(container.id);
      expect(status).toBe(200);
      expect(body.running).toBe(false);

      await cleanupWorker(request, container.id);
    });

    test('editor status returns not running for stopped container', async ({ request }) => {
      const container = await createWorker(request);
      const api = new ApiClient(request);
      await api.stopContainer(container.id);
      await new Promise(r => setTimeout(r, 1000));

      const { status, body } = await api.getEditorStatus(container.id);
      expect(status).toBe(200);
      expect(body.running).toBe(false);

      await cleanupWorker(request, container.id);
    });
  });
});
