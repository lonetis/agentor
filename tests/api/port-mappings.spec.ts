import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createWorker, cleanupWorker, cleanupAllPortMappings } from '../helpers/worker-lifecycle';

test.describe('Port Mappings API', () => {
  let containerId: string;
  let containerName: string;

  test.beforeAll(async ({ request }) => {
    const container = await createWorker(request);
    containerId = container.id;
    containerName = container.name as string;
  });

  test.afterAll(async ({ request }) => {
    await cleanupAllPortMappings(request);
    await cleanupWorker(request, containerId);
  });

  // Note: no afterEach cleanup — port mappings are cleaned up in afterAll
  // Using afterEach with cleanupAllPortMappings causes race conditions with fullyParallel

  test.describe('GET /api/port-mappings', () => {
    test('returns list of port mappings', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.listPortMappings();
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });
  });

  test.describe('POST /api/port-mappings', () => {
    test('creates a localhost port mapping', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.createPortMapping({
        externalPort: 19000,
        type: 'localhost',
        workerId: containerId,
        internalPort: 3000,
      });
      expect(status).toBe(201);
      expect(body.externalPort).toBe(19000);
      expect(body.type).toBe('localhost');
      expect(body.workerName).toBe(containerName);
    });

    test('response includes all expected fields', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.createPortMapping({
        externalPort: 19020,
        type: 'localhost',
        workerId: containerId,
        internalPort: 4000,
      });
      expect(typeof body.externalPort).toBe('number');
      expect(typeof body.internalPort).toBe('number');
      expect(typeof body.type).toBe('string');
      expect(typeof body.workerName).toBe('string');
      expect(body.internalPort).toBe(4000);
    });

    test('creates an external port mapping', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.createPortMapping({
        externalPort: 19001,
        type: 'external',
        workerId: containerId,
        internalPort: 8080,
      });
      expect(status).toBe(201);
      expect(body.type).toBe('external');
    });

    test('rejects missing required fields', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createPortMapping({});
      expect(status).toBe(400);
    });

    test('rejects invalid externalPort (0)', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createPortMapping({
        externalPort: 0,
        type: 'localhost',
        workerId: containerId,
        internalPort: 3000,
      });
      expect(status).toBe(400);
    });

    test('rejects invalid externalPort (65536)', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createPortMapping({
        externalPort: 65536,
        type: 'localhost',
        workerId: containerId,
        internalPort: 3000,
      });
      expect(status).toBe(400);
    });

    test('rejects non-integer port', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createPortMapping({
        externalPort: 3000.5,
        type: 'localhost',
        workerId: containerId,
        internalPort: 3000,
      });
      expect(status).toBe(400);
    });

    test('rejects invalid internalPort (0)', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createPortMapping({
        externalPort: 19010,
        type: 'localhost',
        workerId: containerId,
        internalPort: 0,
      });
      expect(status).toBe(400);
    });

    test('rejects invalid internalPort (65536)', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createPortMapping({
        externalPort: 19011,
        type: 'localhost',
        workerId: containerId,
        internalPort: 65536,
      });
      expect(status).toBe(400);
    });

    test('rejects non-integer internalPort', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createPortMapping({
        externalPort: 19012,
        type: 'localhost',
        workerId: containerId,
        internalPort: 3000.5,
      });
      expect(status).toBe(400);
    });

    test('rejects invalid type', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createPortMapping({
        externalPort: 19002,
        type: 'invalid',
        workerId: containerId,
        internalPort: 3000,
      });
      expect(status).toBe(400);
    });

    test('rejects non-running worker', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createPortMapping({
        externalPort: 19003,
        type: 'localhost',
        workerId: 'non-existent',
        internalPort: 3000,
      });
      expect(status).toBe(400);
    });

    test('rejects duplicate externalPort', async ({ request }) => {
      const api = new ApiClient(request);
      // Use a high unique port to avoid conflicts with other tests
      const uniquePort = 19500 + (Date.now() % 500);

      const { status: firstStatus } = await api.createPortMapping({
        externalPort: uniquePort,
        type: 'localhost',
        workerId: containerId,
        internalPort: 3000,
      });
      expect(firstStatus).toBe(201);

      try {
        // Second creation with same external port should fail
        const { status: secondStatus } = await api.createPortMapping({
          externalPort: uniquePort,
          type: 'external',
          workerId: containerId,
          internalPort: 8080,
        });
        // Should fail due to duplicate port (500 because the store throws)
        expect(secondStatus).toBeGreaterThanOrEqual(400);
      } finally {
        // Self-cleanup to avoid relying on afterEach which may race
        try { await api.deletePortMapping(uniquePort); } catch { /* ignore */ }
      }
    });

    test('accepts optional appType and instanceId', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.createPortMapping({
        externalPort: 19005,
        type: 'localhost',
        workerId: containerId,
        internalPort: 9222,
        appType: 'chromium',
        instanceId: 'test-instance',
      });
      expect(status).toBe(201);
      expect(body.appType).toBe('chromium');
      expect(body.instanceId).toBe('test-instance');
    });
  });

  test.describe('DELETE /api/port-mappings/:port', () => {
    test('removes a port mapping', async ({ request }) => {
      const api = new ApiClient(request);
      await api.createPortMapping({
        externalPort: 19006,
        type: 'localhost',
        workerId: containerId,
        internalPort: 3000,
      });

      const { status, body } = await api.deletePortMapping(19006);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);

      // Verify it's gone
      const { body: mappings } = await api.listPortMappings();
      expect(mappings.some((m: { externalPort: number }) => m.externalPort === 19006)).toBe(false);
    });

    test('handles deleting non-existent port', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.deletePortMapping(99999);
      // Should succeed gracefully
      expect(status).toBe(200);
    });

    test('rejects invalid port', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.deletePortMapping(NaN);
      expect(status).toBe(400);
    });
  });

  test.describe('GET /api/port-mapper/status', () => {
    test('returns mapper status', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.getPortMapperStatus();
      expect(status).toBe(200);
      expect(typeof body.totalMappings).toBe('number');
      expect(typeof body.localhostCount).toBe('number');
      expect(typeof body.externalCount).toBe('number');
      expect(body.totalMappings).toBe(body.localhostCount + body.externalCount);
    });

    test('totalMappings equals sum of localhost and external', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.getPortMapperStatus();
      // The sum invariant should always hold regardless of parallel tests
      expect(body.totalMappings).toBe(body.localhostCount + body.externalCount);
      expect(body.totalMappings).toBeGreaterThanOrEqual(0);
    });
  });

  test.describe('Negative port validation', () => {
    test('rejects negative externalPort', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createPortMapping({
        externalPort: -1,
        type: 'localhost',
        workerId: containerId,
        internalPort: 3000,
      });
      expect(status).toBe(400);
    });

    test('rejects negative internalPort', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createPortMapping({
        externalPort: 19150,
        type: 'localhost',
        workerId: containerId,
        internalPort: -1,
      });
      expect(status).toBe(400);
    });
  });

  test.describe('Port validation edge cases', () => {
    test('rejects externalPort: NaN', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createPortMapping({
        externalPort: NaN,
        type: 'localhost',
        workerId: containerId,
        internalPort: 3000,
      });
      expect(status).toBe(400);
    });

    test('rejects externalPort: "not-a-number"', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createPortMapping({
        externalPort: 'not-a-number',
        type: 'localhost',
        workerId: containerId,
        internalPort: 3000,
      });
      expect(status).toBe(400);
    });

    test('rejects internalPort: NaN', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createPortMapping({
        externalPort: 19100,
        type: 'localhost',
        workerId: containerId,
        internalPort: NaN,
      });
      expect(status).toBe(400);
    });

    test('rejects internalPort: "not-a-number"', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createPortMapping({
        externalPort: 19101,
        type: 'localhost',
        workerId: containerId,
        internalPort: 'not-a-number',
      });
      expect(status).toBe(400);
    });
  });

  test.describe('Worker state validation', () => {
    test('rejects mapping for stopped worker', async ({ request }) => {
      const api = new ApiClient(request);

      // Create a temporary worker, wait for running, then stop it
      const { body: nameData } = await api.generateName();
      const { body: worker } = await api.createContainer({ name: nameData.name });
      const stoppedWorkerId = worker.id;

      try {
        // Wait for the worker to start
        const start = Date.now();
        while (Date.now() - start < 90_000) {
          const { body: containers } = await api.listContainers();
          const found = containers.find((c: { id: string }) => c.id === stoppedWorkerId);
          if (found && found.status === 'running') break;
          await new Promise(r => setTimeout(r, 2000));
        }

        // Stop the worker
        await api.stopContainer(stoppedWorkerId);
        await new Promise(r => setTimeout(r, 2000));

        // Attempt to create a mapping for the stopped worker
        const { status } = await api.createPortMapping({
          externalPort: 19200,
          type: 'localhost',
          workerId: stoppedWorkerId,
          internalPort: 3000,
        });
        expect(status).toBe(400);
      } finally {
        // Cleanup the temporary worker
        try { await api.removeContainer(stoppedWorkerId); } catch { /* ignore */ }
      }
    });
  });

  test.describe('Mapper status after operations', () => {
    test('localhostCount increases after creating localhost mapping', async ({ request }) => {
      const api = new ApiClient(request);
      const uniquePort = 19300 + (Date.now() % 100);

      const { body: before } = await api.getPortMapperStatus();

      const { status } = await api.createPortMapping({
        externalPort: uniquePort,
        type: 'localhost',
        workerId: containerId,
        internalPort: 3000,
      });
      expect(status).toBe(201);

      try {
        const { body: after } = await api.getPortMapperStatus();
        // Only check the specific count (totalMappings can race with parallel tests)
        expect(after.localhostCount).toBeGreaterThanOrEqual(before.localhostCount + 1);
      } finally {
        try { await api.deletePortMapping(uniquePort); } catch { /* ignore */ }
      }
    });

    test('externalCount increases after creating external mapping', async ({ request }) => {
      const api = new ApiClient(request);
      const uniquePort = 19400 + (Date.now() % 100);

      const { body: before } = await api.getPortMapperStatus();

      const { status } = await api.createPortMapping({
        externalPort: uniquePort,
        type: 'external',
        workerId: containerId,
        internalPort: 8080,
      });
      expect(status).toBe(201);

      try {
        const { body: after } = await api.getPortMapperStatus();
        // Only check the specific count (totalMappings can race with parallel tests)
        expect(after.externalCount).toBeGreaterThanOrEqual(before.externalCount + 1);
      } finally {
        try { await api.deletePortMapping(uniquePort); } catch { /* ignore */ }
      }
    });
  });
});
