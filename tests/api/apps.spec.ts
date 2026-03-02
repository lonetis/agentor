import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';

test.describe('Apps API', () => {
  let containerId: string;

  test.beforeAll(async ({ request }) => {
    const container = await createWorker(request);
    containerId = container.id;
  });

  test.afterAll(async ({ request }) => {
    await cleanupWorker(request, containerId);
  });

  test.describe('GET /api/containers/:id/apps', () => {
    test('lists all running apps (initially empty)', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.listApps(containerId);
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });
  });

  test.describe('GET /api/containers/:id/apps/:appType', () => {
    test('lists chromium instances (initially empty)', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.listAppsByType(containerId, 'chromium');
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });

    test('lists socks5 instances (initially empty)', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.listAppsByType(containerId, 'socks5');
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });
  });

  test.describe('App lifecycle (start/list/stop)', () => {
    test('starts and stops a socks5 app', async ({ request }) => {
      const api = new ApiClient(request);

      // Start
      const { status: startStatus, body: startBody } = await api.startApp(containerId, 'socks5');
      expect(startStatus).toBe(201);
      expect(startBody.id || startBody.instanceId || startBody.port).toBeTruthy();

      // Wait a bit for app to start
      await new Promise(r => setTimeout(r, 2000));

      // List
      const { body: apps } = await api.listAppsByType(containerId, 'socks5');
      expect(apps.length).toBeGreaterThan(0);

      // Stop
      const instanceId = apps[0].id;
      const { status: stopStatus } = await api.stopApp(containerId, 'socks5', instanceId);
      expect(stopStatus).toBe(200);
    });

    test('can start a chromium app (returns 201)', async ({ request }) => {
      const api = new ApiClient(request);

      // Start - the API should succeed even if Chromium exits quickly in the container
      const { status: startStatus, body: startBody } = await api.startApp(containerId, 'chromium');
      expect(startStatus).toBe(201);
      // The response should indicate the app was started
      expect(startBody).toBeTruthy();
    });
  });

  test.describe('Error handling', () => {
    test('rejects invalid app type', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.startApp(containerId, 'nonexistent-app');
      expect(status).toBeGreaterThanOrEqual(400);
    });

    test('listing unknown app type returns empty list', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.listAppsByType(containerId, 'nonexistent-app');
      // API is lenient: returns empty list for unknown types
      expect(status).toBe(200);
      expect(body).toEqual([]);
    });

    test('rejects starting app on non-existent container', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.startApp('non-existent-id', 'socks5');
      expect(status).toBeGreaterThanOrEqual(400);
    });

    test('rejects stopping non-existent app instance', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.stopApp(containerId, 'socks5', 'non-existent-instance');
      expect(status).toBeGreaterThanOrEqual(400);
    });

    test('listing all apps on non-existent container returns empty', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.listApps('non-existent-id');
      expect(status).toBe(200);
      expect(body).toEqual([]);
    });

    test('listing apps by type on non-existent container returns empty', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.listAppsByType('non-existent-id', 'socks5');
      expect(status).toBe(200);
      expect(body).toEqual([]);
    });
  });

  test.describe('Response fields', () => {
    test('socks5 start response includes id and port', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.startApp(containerId, 'socks5');
      expect(status).toBe(201);
      expect(typeof body.id).toBe('string');
      expect(typeof body.port).toBe('number');

      // Cleanup
      await new Promise(r => setTimeout(r, 1000));
      const { body: apps } = await api.listAppsByType(containerId, 'socks5');
      for (const app of apps) {
        await api.stopApp(containerId, 'socks5', app.id);
      }
    });

    test('socks5 list shows running instance fields', async ({ request }) => {
      const api = new ApiClient(request);
      await api.startApp(containerId, 'socks5');
      await new Promise(r => setTimeout(r, 2000));

      const { body: apps } = await api.listAppsByType(containerId, 'socks5');
      expect(apps.length).toBeGreaterThan(0);
      const instance = apps[0];
      expect(typeof instance.id).toBe('string');
      expect(typeof instance.port).toBe('number');

      // Cleanup
      for (const app of apps) {
        await api.stopApp(containerId, 'socks5', app.id);
      }
    });

    test('stop response returns ok', async ({ request }) => {
      const api = new ApiClient(request);
      await api.startApp(containerId, 'socks5');
      await new Promise(r => setTimeout(r, 2000));

      const { body: apps } = await api.listAppsByType(containerId, 'socks5');
      expect(apps.length).toBeGreaterThan(0);

      const { status, body } = await api.stopApp(containerId, 'socks5', apps[0].id);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
    });
  });
});
