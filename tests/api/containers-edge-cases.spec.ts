import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';

test.describe('Containers API — Edge Cases', () => {
  const createdContainerIds: string[] = [];

  test.afterEach(async ({ request }) => {
    for (const id of createdContainerIds) {
      await cleanupWorker(request, id);
    }
    createdContainerIds.length = 0;
  });

  test.describe('Invalid environment ID', () => {
    test('rejects creation with non-existent environment ID', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createContainer({
        environmentId: 'non-existent-env-id-12345',
      });
      expect(status).toBeGreaterThanOrEqual(400);
    });
  });

  test.describe('Container name constraints', () => {
    test('handles very long display name', async ({ request }) => {
      const longName = 'a'.repeat(200);
      const container = await createWorker(request, { displayName: longName });
      createdContainerIds.push(container.id);

      const api = new ApiClient(request);
      const { body: containers } = await api.listContainers();
      const found = containers.find((c: { id: string }) => c.id === container.id);
      expect(found).toBeTruthy();
      expect(found.displayName).toBe(longName);
    });

    test('auto-generates name when none provided', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.createContainer({});
      expect(status).toBe(201);
      expect(body.name).toBeTruthy();
      expect(body.name.length).toBeGreaterThan(0);
      createdContainerIds.push(body.id);
    });
  });

  test.describe('Operations on stopped containers', () => {
    test('stop on already stopped container returns error', async ({ request }) => {
      const container = await createWorker(request);
      createdContainerIds.push(container.id);

      const api = new ApiClient(request);
      // Stop it first
      const { status: stopStatus } = await api.stopContainer(container.id);
      expect(stopStatus).toBe(200);

      // Wait for stop
      await new Promise(r => setTimeout(r, 2000));

      // Try stopping again
      const { status: secondStop } = await api.stopContainer(container.id);
      expect(secondStop).toBeGreaterThanOrEqual(400);
    });

    test('workspace download fails on stopped container', async ({ request }) => {
      const container = await createWorker(request);
      createdContainerIds.push(container.id);

      const api = new ApiClient(request);
      await api.stopContainer(container.id);
      await new Promise(r => setTimeout(r, 2000));

      const { status } = await api.downloadWorkspace(container.id);
      expect(status).toBeGreaterThanOrEqual(400);
    });

    test('restart on stopped container works', async ({ request }) => {
      const container = await createWorker(request);
      createdContainerIds.push(container.id);

      const api = new ApiClient(request);
      await api.stopContainer(container.id);
      await new Promise(r => setTimeout(r, 2000));

      const { status } = await api.restartContainer(container.id);
      expect(status).toBe(200);
    });

    test('port mappings survive stop and restart', async ({ request }) => {
      const container = await createWorker(request);
      createdContainerIds.push(container.id);
      const api = new ApiClient(request);
      const port = 10000 + Math.floor(Math.random() * 50000);

      await api.createPortMapping({
        externalPort: port,
        internalPort: 8080,
        type: 'localhost',
        workerId: container.id,
      });

      try {
        await api.stopContainer(container.id);
        await new Promise(r => setTimeout(r, 1500));

        // Mapping should still exist while the worker is stopped
        const { body: stoppedMappings } = await api.listPortMappings();
        const stoppedFound = stoppedMappings.find((m: { externalPort: number }) => m.externalPort === port);
        expect(stoppedFound).toBeTruthy();
        expect(stoppedFound.workerName).toBe(container.name);

        await api.restartContainer(container.id);
        await new Promise(r => setTimeout(r, 1500));

        // Mapping still present after restart
        const { body: restartedMappings } = await api.listPortMappings();
        const restartedFound = restartedMappings.find((m: { externalPort: number }) => m.externalPort === port);
        expect(restartedFound).toBeTruthy();
      } finally {
        await api.deletePortMapping(port);
      }
    });
  });

  test.describe('Non-existent container operations', () => {
    test('stop non-existent container returns error', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.stopContainer('non-existent-container-id');
      expect(status).toBeGreaterThanOrEqual(400);
    });

    test('remove non-existent container returns error', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.removeContainer('non-existent-container-id');
      expect(status).toBeGreaterThanOrEqual(400);
    });

    test('logs for non-existent container returns error', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.getContainerLogs('non-existent-container-id');
      expect(status).toBeGreaterThanOrEqual(400);
    });
  });

  test.describe('Archive and unarchive', () => {
    test('archive a running container', async ({ request }) => {
      const container = await createWorker(request);
      // Don't add to cleanup — archive handles removal

      const api = new ApiClient(request);
      const { status } = await api.archiveContainer(container.id);
      expect(status).toBe(200);

      // Should appear in archived list
      const { body: archived } = await api.listArchived();
      const found = archived.find((w: { name: string }) => w.name === container.name);
      expect(found).toBeTruthy();
      expect(found.status).toBe('archived');

      // Cleanup archived worker
      await api.deleteArchivedWorker(container.name);
    });
  });
});
