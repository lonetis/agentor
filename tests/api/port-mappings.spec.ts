import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';

let _portCounter = 0;
function uniquePort(): number {
  const base = 10000 + Math.floor(Math.random() * 40000);
  return base + (_portCounter++ % 10000);
}

test.describe('Port Mappings API', () => {
  let containerId: string;
  let containerName: string;

  test.beforeAll(async ({ request }) => {
    const container = await createWorker(request);
    containerId = container.id;
    containerName = container.name as string;
  });

  test.afterAll(async ({ request }) => {
    // Only clean up mappings for our specific worker (not globally — avoids parallel interference)
    const api = new ApiClient(request);
    const { body: mappings } = await api.listPortMappings();
    for (const m of mappings) {
      if (m.workerId === containerId) {
        try { await api.deletePortMapping(m.externalPort); } catch { /* ignore */ }
      }
    }
    await cleanupWorker(request, containerId);
  });

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
      const port = uniquePort();
      const { status, body } = await api.createPortMapping({
        externalPort: port,
        type: 'localhost',
        workerId: containerId,
        internalPort: uniquePort(),
      });
      expect(status).toBe(201);
      expect(body.externalPort).toBe(port);
      expect(body.type).toBe('localhost');
      expect(body.workerName).toBe(containerName);
    });

    test('response includes all expected fields', async ({ request }) => {
      const api = new ApiClient(request);
      const intPort = uniquePort();
      const { body } = await api.createPortMapping({
        externalPort: uniquePort(),
        type: 'localhost',
        workerId: containerId,
        internalPort: intPort,
      });
      expect(typeof body.externalPort).toBe('number');
      expect(typeof body.internalPort).toBe('number');
      expect(typeof body.type).toBe('string');
      expect(typeof body.workerName).toBe('string');
      expect(body.internalPort).toBe(intPort);
    });

    test('creates an external port mapping', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.createPortMapping({
        externalPort: uniquePort(),
        type: 'external',
        workerId: containerId,
        internalPort: uniquePort(),
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
        internalPort: uniquePort(),
      });
      expect(status).toBe(400);
    });

    test('rejects invalid externalPort (65536)', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createPortMapping({
        externalPort: 65536,
        type: 'localhost',
        workerId: containerId,
        internalPort: uniquePort(),
      });
      expect(status).toBe(400);
    });

    test('rejects non-integer port', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createPortMapping({
        externalPort: 3000.5,
        type: 'localhost',
        workerId: containerId,
        internalPort: uniquePort(),
      });
      expect(status).toBe(400);
    });

    test('rejects invalid internalPort (0)', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createPortMapping({
        externalPort: uniquePort(),
        type: 'localhost',
        workerId: containerId,
        internalPort: 0,
      });
      expect(status).toBe(400);
    });

    test('rejects invalid internalPort (65536)', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createPortMapping({
        externalPort: uniquePort(),
        type: 'localhost',
        workerId: containerId,
        internalPort: 65536,
      });
      expect(status).toBe(400);
    });

    test('rejects non-integer internalPort', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createPortMapping({
        externalPort: uniquePort(),
        type: 'localhost',
        workerId: containerId,
        internalPort: 3000.5,
      });
      expect(status).toBe(400);
    });

    test('rejects invalid type', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createPortMapping({
        externalPort: uniquePort(),
        type: 'invalid',
        workerId: containerId,
        internalPort: uniquePort(),
      });
      expect(status).toBe(400);
    });

    test('rejects non-running worker', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createPortMapping({
        externalPort: uniquePort(),
        type: 'localhost',
        workerId: 'non-existent',
        internalPort: uniquePort(),
      });
      expect(status).toBe(400);
    });

    test('rejects duplicate externalPort', async ({ request }) => {
      const api = new ApiClient(request);
      const port = uniquePort();

      const { status: firstStatus } = await api.createPortMapping({
        externalPort: port,
        type: 'localhost',
        workerId: containerId,
        internalPort: uniquePort(),
      });
      expect(firstStatus).toBe(201);

      try {
        // Second creation with same external port should fail
        const { status: secondStatus } = await api.createPortMapping({
          externalPort: port,
          type: 'external',
          workerId: containerId,
          internalPort: uniquePort(),
        });
        // Should fail due to duplicate port (500 because the store throws)
        expect(secondStatus).toBeGreaterThanOrEqual(400);
      } finally {
        // Self-cleanup to avoid relying on afterEach which may race
        try { await api.deletePortMapping(port); } catch { /* ignore */ }
      }
    });

    test('accepts optional appType and instanceId', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.createPortMapping({
        externalPort: uniquePort(),
        type: 'localhost',
        workerId: containerId,
        internalPort: uniquePort(),
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
      const port = uniquePort();
      await api.createPortMapping({
        externalPort: port,
        type: 'localhost',
        workerId: containerId,
        internalPort: uniquePort(),
      });

      const { status, body } = await api.deletePortMapping(port);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);

      // Verify it's gone
      const { body: mappings } = await api.listPortMappings();
      expect(mappings.some((m: { externalPort: number }) => m.externalPort === port)).toBe(false);
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
        internalPort: uniquePort(),
      });
      expect(status).toBe(400);
    });

    test('rejects negative internalPort', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createPortMapping({
        externalPort: uniquePort(),
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
        internalPort: uniquePort(),
      });
      expect(status).toBe(400);
    });

    test('rejects externalPort: "not-a-number"', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createPortMapping({
        externalPort: 'not-a-number',
        type: 'localhost',
        workerId: containerId,
        internalPort: uniquePort(),
      });
      expect(status).toBe(400);
    });

    test('rejects internalPort: NaN', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createPortMapping({
        externalPort: uniquePort(),
        type: 'localhost',
        workerId: containerId,
        internalPort: NaN,
      });
      expect(status).toBe(400);
    });

    test('rejects internalPort: "not-a-number"', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createPortMapping({
        externalPort: uniquePort(),
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
          externalPort: uniquePort(),
          type: 'localhost',
          workerId: stoppedWorkerId,
          internalPort: uniquePort(),
        });
        expect(status).toBe(400);
      } finally {
        // Cleanup the temporary worker
        try { await api.removeContainer(stoppedWorkerId); } catch { /* ignore */ }
      }
    });
  });

  test.describe('Mapper status after operations', () => {
    test('localhostCount reflects created localhost mapping', async ({ request }) => {
      const api = new ApiClient(request);
      const port = uniquePort();

      const { status } = await api.createPortMapping({
        externalPort: port,
        type: 'localhost',
        workerId: containerId,
        internalPort: uniquePort(),
      });
      expect(status).toBe(201);

      try {
        // Wait for mapper container reconciliation (async) — retry up to 15s
        let localhostCount = 0;
        const start = Date.now();
        while (Date.now() - start < 15_000) {
          await new Promise(r => setTimeout(r, 1000));
          const { body: statusBody } = await api.getPortMapperStatus();
          localhostCount = statusBody.localhostCount;
          if (localhostCount > 0) break;
        }
        expect(localhostCount).toBeGreaterThan(0);
      } finally {
        try { await api.deletePortMapping(port); } catch { /* ignore */ }
      }
    });

    test('externalCount reflects created external mapping', async ({ request }) => {
      const api = new ApiClient(request);
      const port = uniquePort();

      const { status } = await api.createPortMapping({
        externalPort: port,
        type: 'external',
        workerId: containerId,
        internalPort: uniquePort(),
      });
      expect(status).toBe(201);

      try {
        // Wait for mapper container reconciliation (async) — retry up to 15s
        let externalCount = 0;
        const start = Date.now();
        while (Date.now() - start < 15_000) {
          await new Promise(r => setTimeout(r, 1000));
          const { body: statusBody } = await api.getPortMapperStatus();
          externalCount = statusBody.externalCount;
          if (externalCount > 0) break;
        }
        expect(externalCount).toBeGreaterThan(0);
      } finally {
        try { await api.deletePortMapping(port); } catch { /* ignore */ }
      }
    });
  });
});
