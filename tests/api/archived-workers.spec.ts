import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';

test.describe('Archived Workers API', () => {
  test.describe('GET /api/archived', () => {
    test('returns list of archived workers', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.listArchived();
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });
  });

  test.describe('Archive and unarchive flow', () => {
    test('archives a worker and lists it', async ({ request }) => {
      const container = await createWorker(request);
      const api = new ApiClient(request);

      // Archive the container
      const { status: archiveStatus } = await api.archiveContainer(container.id);
      expect(archiveStatus).toBe(200);

      // List archived - should contain our worker
      const { body: archived } = await api.listArchived();
      const found = archived.find((w: { name: string }) => w.name === container.name);
      expect(found).toBeTruthy();
      expect(found.name).toBe(container.name);

      // Cleanup
      await api.deleteArchivedWorker(container.name);
    });

    test('unarchives a worker', async ({ request }) => {
      const container = await createWorker(request);
      const api = new ApiClient(request);

      // Archive
      await api.archiveContainer(container.id);

      // Unarchive
      const { status, body } = await api.unarchiveWorker(container.name);
      expect(status).toBe(200);
      expect(body.name).toBe(container.name);

      // Verify it's back in active containers
      const { body: containers } = await api.listContainers();
      const found = containers.find((c: { name: string }) => c.name === container.name);
      expect(found).toBeTruthy();

      // Cleanup
      await cleanupWorker(request, body.id);
    });

    test('permanently deletes an archived worker', async ({ request }) => {
      const container = await createWorker(request);
      const api = new ApiClient(request);

      // Archive
      await api.archiveContainer(container.id);

      // Delete
      const { status, body } = await api.deleteArchivedWorker(container.name);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);

      // Verify it's gone
      const { body: archived } = await api.listArchived();
      const found = archived.find((w: { name: string }) => w.name === container.name);
      expect(found).toBeUndefined();
    });
  });

  test.describe('Error handling', () => {
    test('unarchive rejects non-existent worker', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.unarchiveWorker('non-existent-worker-name');
      expect(status).toBeGreaterThanOrEqual(400);
    });

    test('delete rejects non-existent archived worker', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.deleteArchivedWorker('non-existent-worker-name');
      expect(status).toBeGreaterThanOrEqual(400);
    });
  });

  test.describe('Response fields', () => {
    test('archived worker has expected fields', async ({ request }) => {
      const container = await createWorker(request, { displayName: `Archived-${Date.now()}` });
      const api = new ApiClient(request);
      await api.archiveContainer(container.id);

      const { body: archived } = await api.listArchived();
      const found = archived.find((w: { name: string }) => w.name === container.name);
      expect(found).toBeTruthy();
      expect(typeof found.name).toBe('string');
      expect(typeof found.createdAt).toBe('string');
      expect(typeof found.archivedAt).toBe('string');

      await api.deleteArchivedWorker(container.name);
    });

    test('unarchive returns new container id', async ({ request }) => {
      const container = await createWorker(request);
      const api = new ApiClient(request);
      await api.archiveContainer(container.id);

      const { body } = await api.unarchiveWorker(container.name);
      expect(typeof body.id).toBe('string');
      expect(body.id.length).toBeGreaterThan(0);
      expect(body.name).toBe(container.name);

      await cleanupWorker(request, body.id);
    });

    test('unarchive preserves displayName', async ({ request }) => {
      const displayName = `Restore-${Date.now()}`;
      const container = await createWorker(request, { displayName });
      const api = new ApiClient(request);
      await api.archiveContainer(container.id);

      const { body } = await api.unarchiveWorker(container.name);
      expect(body.displayName).toBe(displayName);

      await cleanupWorker(request, body.id);
    });

    test('archived worker has displayName field', async ({ request }) => {
      const displayName = `FieldCheck-${Date.now()}`;
      const container = await createWorker(request, { displayName });
      const api = new ApiClient(request);
      await api.archiveContainer(container.id);

      const { body: archived } = await api.listArchived();
      const found = archived.find((w: { name: string }) => w.name === container.name);
      expect(found).toBeTruthy();
      expect(found.displayName).toBe(displayName);

      await api.deleteArchivedWorker(container.name);
    });

    test('archived worker has image or environmentId field', async ({ request }) => {
      const container = await createWorker(request, { displayName: `ImageField-${Date.now()}` });
      const api = new ApiClient(request);
      await api.archiveContainer(container.id);

      const { body: archived } = await api.listArchived();
      const found = archived.find((w: { name: string }) => w.name === container.name);
      expect(found).toBeTruthy();
      // Worker should have at least one of image or environmentId
      const hasImage = typeof found.image === 'string';
      const hasEnvId = typeof found.environmentId === 'string';
      expect(hasImage || hasEnvId).toBe(true);

      await api.deleteArchivedWorker(container.name);
    });
  });

  test.describe('Archive edge cases', () => {
    test('unarchive and verify running status', async ({ request }) => {
      const container = await createWorker(request);
      const api = new ApiClient(request);

      // Archive
      await api.archiveContainer(container.id);

      // Verify archived
      const { body: archived } = await api.listArchived();
      expect(archived.some((w: { name: string }) => w.name === container.name)).toBe(true);

      // Unarchive
      const { body: unarchived } = await api.unarchiveWorker(container.name);
      expect(unarchived.id).toBeTruthy();

      // Wait for running status
      const start = Date.now();
      let isRunning = false;
      while (Date.now() - start < 90_000) {
        const { body: containers } = await api.listContainers();
        const found = containers.find((c: { id: string }) => c.id === unarchived.id);
        if (found && found.status === 'running') {
          isRunning = true;
          break;
        }
        await new Promise(r => setTimeout(r, 2000));
      }
      expect(isRunning).toBe(true);

      await cleanupWorker(request, unarchived.id);
    });

    test('double archive returns error for already-gone container', async ({ request }) => {
      const container = await createWorker(request);
      const api = new ApiClient(request);

      // First archive succeeds
      const { status: firstStatus } = await api.archiveContainer(container.id);
      expect(firstStatus).toBe(200);

      // Second archive should fail — container is already removed
      const { status: secondStatus } = await api.archiveContainer(container.id);
      expect(secondStatus).toBeGreaterThanOrEqual(400);

      // Cleanup
      await api.deleteArchivedWorker(container.name);
    });
  });

  test.describe('Mapping persistence across archive/unarchive', () => {
    test('port mappings survive archive and are reassigned on unarchive', async ({ request }) => {
      const container = await createWorker(request);
      const api = new ApiClient(request);
      const port = 10000 + Math.floor(Math.random() * 50000);

      await api.createPortMapping({
        externalPort: port,
        internalPort: 8080,
        type: 'localhost',
        workerId: container.id,
      });

      try {
        // Archive — mapping must remain, but container ID is gone
        await api.archiveContainer(container.id);

        const { body: afterArchive } = await api.listPortMappings();
        const archivedMapping = afterArchive.find((m: { externalPort: number }) => m.externalPort === port);
        expect(archivedMapping).toBeTruthy();
        expect(archivedMapping.workerName).toBe(container.name);

        // Unarchive — mapping workerId should now point at the new container
        const { body: unarchived } = await api.unarchiveWorker(container.name);
        const { body: afterUnarchive } = await api.listPortMappings();
        const restoredMapping = afterUnarchive.find((m: { externalPort: number }) => m.externalPort === port);
        expect(restoredMapping).toBeTruthy();
        expect(restoredMapping.workerName).toBe(container.name);
        expect(restoredMapping.workerId).toBe(unarchived.id);

        await cleanupWorker(request, unarchived.id);
      } finally {
        await api.deletePortMapping(port);
      }
    });

    test('port mappings are removed when an archived worker is permanently deleted', async ({ request }) => {
      const container = await createWorker(request);
      const api = new ApiClient(request);
      const port = 10000 + Math.floor(Math.random() * 50000);

      await api.createPortMapping({
        externalPort: port,
        internalPort: 8080,
        type: 'localhost',
        workerId: container.id,
      });

      await api.archiveContainer(container.id);
      await api.deleteArchivedWorker(container.name);

      const { body: mappings } = await api.listPortMappings();
      const found = mappings.find((m: { externalPort: number }) => m.externalPort === port);
      expect(found).toBeUndefined();
    });
  });
});
