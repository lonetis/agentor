import { test, expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';
import { createTestUser, deleteTestUser, type CreatedUser } from '../helpers/test-users';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

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
      const found = archived.find((w: { id: string }) => w.id === container.id);
      expect(found).toBeTruthy();
      expect(found.id).toBe(container.id);

      // Cleanup
      await api.deleteArchivedWorker(container.id);
    });

    test('unarchives a worker', async ({ request }) => {
      const container = await createWorker(request);
      const api = new ApiClient(request);

      // Archive
      await api.archiveContainer(container.id);

      // Unarchive
      const { status, body } = await api.unarchiveWorker(container.id);
      expect(status).toBe(200);
      expect(body.id).toBe(container.id);

      // Verify it's back in active containers
      const { body: containers } = await api.listContainers();
      const found = containers.find((c: { id: string }) => c.id === container.id);
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
      const { status, body } = await api.deleteArchivedWorker(container.id);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);

      // Verify it's gone
      const { body: archived } = await api.listArchived();
      const found = archived.find((w: { id: string }) => w.id === container.id);
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
      const found = archived.find((w: { id: string }) => w.id === container.id);
      expect(found).toBeTruthy();
      expect(typeof found.id).toBe('string');
      expect(typeof found.createdAt).toBe('string');
      expect(typeof found.archivedAt).toBe('string');

      await api.deleteArchivedWorker(container.id);
    });

    test('unarchive returns the same worker id with a new Docker container', async ({ request }) => {
      const container = await createWorker(request);
      const api = new ApiClient(request);
      await api.archiveContainer(container.id);

      const { body } = await api.unarchiveWorker(container.id);
      expect(typeof body.id).toBe('string');
      expect(body.id.length).toBeGreaterThan(0);
      // Worker identity (id) is preserved across archive/unarchive...
      expect(body.id).toBe(container.id);
      // ...but a fresh Docker container is created.
      expect(body.containerId).toBeTruthy();
      expect(body.containerId).not.toBe(container.containerId);

      await cleanupWorker(request, body.id);
    });

    test('unarchive preserves displayName', async ({ request }) => {
      const displayName = `Restore-${Date.now()}`;
      const container = await createWorker(request, { displayName });
      const api = new ApiClient(request);
      await api.archiveContainer(container.id);

      const { body } = await api.unarchiveWorker(container.id);
      expect(body.displayName).toBe(displayName);

      await cleanupWorker(request, body.id);
    });

    test('archived worker has displayName field', async ({ request }) => {
      const displayName = `FieldCheck-${Date.now()}`;
      const container = await createWorker(request, { displayName });
      const api = new ApiClient(request);
      await api.archiveContainer(container.id);

      const { body: archived } = await api.listArchived();
      const found = archived.find((w: { id: string }) => w.id === container.id);
      expect(found).toBeTruthy();
      expect(found.displayName).toBe(displayName);

      await api.deleteArchivedWorker(container.id);
    });

    test('archived worker omits Docker-derived fields (discovered at runtime, not stored)', async ({ request }) => {
      const container = await createWorker(request, { displayName: `Normalized-${Date.now()}` });
      const api = new ApiClient(request);
      await api.archiveContainer(container.id);

      const { body: archived } = await api.listArchived();
      const found = archived.find((w: { id: string }) => w.id === container.id);
      expect(found).toBeTruthy();
      // The slim record keeps the worker's identity, label, and lifecycle state...
      expect(typeof found.id).toBe('string');
      expect(typeof found.displayName).toBe('string');
      expect(found.status).toBe('archived');
      // ...and omits everything Docker re-discovers at runtime via the agentor.id
      // label (containerId, containerName, imageName, imageId).
      expect(found.containerId).toBeUndefined();
      expect(found.containerName).toBeUndefined();
      expect(found.imageName).toBeUndefined();
      expect(found.imageId).toBeUndefined();

      await api.deleteArchivedWorker(container.id);
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
      expect(archived.some((w: { id: string }) => w.id === container.id)).toBe(true);

      // Unarchive
      const { body: unarchived } = await api.unarchiveWorker(container.id);
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
      await api.deleteArchivedWorker(container.id);
    });
  });

  test.describe('Mapping persistence across archive/unarchive', () => {
    test('port mappings survive archive and unarchive (keyed by containerName)', async ({ request }) => {
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
        // Archive — mapping must remain, keyed by containerName not container ID
        await api.archiveContainer(container.id);

        const { body: afterArchive } = await api.listPortMappings();
        const archivedMapping = afterArchive.find((m: { externalPort: number }) => m.externalPort === port);
        expect(archivedMapping).toBeTruthy();
        expect(archivedMapping.workerId).toBe(container.id);
        expect(archivedMapping.containerName).toBe(container.containerName);

        // Unarchive — containerName is stable; Traefik will pick up the new
        // container automatically via Docker DNS.
        const { body: unarchived } = await api.unarchiveWorker(container.id);
        const { body: afterUnarchive } = await api.listPortMappings();
        const restoredMapping = afterUnarchive.find((m: { externalPort: number }) => m.externalPort === port);
        expect(restoredMapping).toBeTruthy();
        expect(restoredMapping.workerId).toBe(container.id);
        expect(restoredMapping.containerName).toBe(container.containerName);

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
      await api.deleteArchivedWorker(container.id);

      const { body: mappings } = await api.listPortMappings();
      const found = mappings.find((m: { externalPort: number }) => m.externalPort === port);
      expect(found).toBeUndefined();
    });
  });

  // Admin acting on another user's archived worker. The archived list returns
  // every user's workers to an admin; the unarchive/delete routes must resolve
  // the worker globally by id and allow admin access (no ?userId= hack). This is
  // a regression guard for the authz bug where the admin's action silently 404'd.
  test.describe('Admin acts on another user\'s archived worker', () => {
    let user: CreatedUser;
    let userCtx: APIRequestContext;

    test.beforeAll(async () => {
      user = await createTestUser('Archived Owner');
      userCtx = await playwrightRequest.newContext({
        baseURL: BASE_URL,
        extraHTTPHeaders: { Origin: BASE_URL },
        storageState: { cookies: [], origins: [] },
      });
      const userApi = new ApiClient(userCtx);
      const signIn = await userApi.signInEmail(user.email, user.password);
      if (signIn.status !== 200) throw new Error(`sign-in failed: ${signIn.status}`);
    });

    test.afterAll(async () => {
      await userCtx?.dispose();
      if (user) await deleteTestUser(user.id);
    });

    test('admin can unarchive a regular user\'s worker via /api/archived/:id', async ({ request }) => {
      const userApi = new ApiClient(userCtx);
      // The regular user creates + archives their own worker.
      const worker = await createWorker(userCtx);
      await userApi.archiveContainer(worker.id);

      // Admin (default project context) sees it in the global archived list.
      const adminApi = new ApiClient(request);
      const { body: adminList } = await adminApi.listArchived();
      expect(adminList.some((w: { id: string }) => w.id === worker.id)).toBe(true);

      // Admin unarchives it with NO ?userId= — resolves globally by id.
      const { status, body } = await adminApi.unarchiveWorker(worker.id);
      expect(status).toBe(200);
      expect(body.id).toBe(worker.id);
      // Ownership is preserved — the restored worker still belongs to the user.
      expect(body.userId).toBe(user.id);

      await cleanupWorker(userCtx, worker.id);
    });

    test('admin can delete a regular user\'s archived worker via /api/archived/:id', async ({ request }) => {
      const userApi = new ApiClient(userCtx);
      const worker = await createWorker(userCtx);
      await userApi.archiveContainer(worker.id);

      const adminApi = new ApiClient(request);
      const { status, body } = await adminApi.deleteArchivedWorker(worker.id);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);

      // Gone from the user's archived list too.
      const { body: userList } = await userApi.listArchived();
      expect(userList.some((w: { id: string }) => w.id === worker.id)).toBe(false);
    });

    test('a regular user cannot unarchive another user\'s archived worker (403)', async ({ request }) => {
      // Admin creates + archives a worker (owned by admin).
      const adminApi = new ApiClient(request);
      const worker = await createWorker(request);
      await adminApi.archiveContainer(worker.id);

      try {
        // The regular user must NOT be able to act on it.
        const userApi = new ApiClient(userCtx);
        const { status } = await userApi.unarchiveWorker(worker.id);
        expect(status).toBe(403);
      } finally {
        await adminApi.deleteArchivedWorker(worker.id);
      }
    });
  });
});
