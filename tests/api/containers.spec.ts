import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';

test.describe('Containers API', () => {
  // Track containers created during tests for cleanup
  const createdContainerIds: string[] = [];

  test.afterEach(async ({ request }) => {
    for (const id of createdContainerIds) {
      await cleanupWorker(request, id);
    }
    createdContainerIds.length = 0;
  });

  test.describe('GET /api/containers', () => {
    test('returns a list of containers', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.listContainers();
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });

    test('container entries have required fields', async ({ request }) => {
      const container = await createWorker(request);
      createdContainerIds.push(container.id);

      const api = new ApiClient(request);
      const { body } = await api.listContainers();
      const found = body.find((c: { id: string }) => c.id === container.id);
      expect(found).toBeTruthy();
      expect(typeof found.id).toBe('string');
      expect(typeof found.name).toBe('string');
      expect(typeof found.status).toBe('string');
      expect(typeof found.createdAt).toBe('string');
      expect(typeof found.image).toBe('string');
      expect(typeof found.imageId).toBe('string');
      expect(found.labels).toBeTruthy();
    });
  });

  test.describe('GET /api/containers/generate-name', () => {
    test('returns a generated name', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.generateName();
      expect(status).toBe(200);
      expect(typeof body.name).toBe('string');
      expect(body.name.length).toBeGreaterThan(0);
    });

    test('generates unique names', async ({ request }) => {
      const api = new ApiClient(request);
      const names = new Set<string>();
      for (let i = 0; i < 5; i++) {
        const { body } = await api.generateName();
        names.add(body.name);
      }
      // All 5 names should be unique
      expect(names.size).toBe(5);
    });

    test('generated names are valid container names', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.generateName();
      // Container names contain alphanumeric chars (mixed case) and dashes
      expect(body.name).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]$/);
      expect(body.name.length).toBeGreaterThan(5);
    });
  });

  test.describe('POST /api/containers', () => {
    test('creates a container and returns 201', async ({ request }) => {
      const container = await createWorker(request);
      createdContainerIds.push(container.id);
      expect(container.id).toBeTruthy();
      expect(container.name).toBeTruthy();
      expect(container.status).toBe('running');
    });

    test('creates a container with a display name', async ({ request }) => {
      const container = await createWorker(request, { displayName: 'Test Worker' });
      createdContainerIds.push(container.id);
      expect(container.displayName).toBe('Test Worker');
    });

    test('creates a container with dockerEnabled', async ({ request }) => {
      const container = await createWorker(request, { dockerEnabled: true });
      createdContainerIds.push(container.id);
      expect(container.id).toBeTruthy();
    });

    test('rejects invalid cpuLimit (NaN)', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.createContainer({ cpuLimit: 'not-a-number' });
      expect(status).toBe(400);
      expect(body.statusMessage).toContain('cpuLimit');
    });

    test('rejects negative cpuLimit', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createContainer({ cpuLimit: -1 });
      expect(status).toBe(400);
    });

    test('rejects zero cpuLimit', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createContainer({ cpuLimit: 0 });
      expect(status).toBe(400);
    });

    test('rejects invalid mounts JSON string', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.createContainer({ mounts: 'not-json' });
      expect(status).toBe(400);
      expect(body.statusMessage).toContain('mounts');
    });

    test('rejects invalid repos JSON string', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.createContainer({ repos: 'not-json' });
      expect(status).toBe(400);
      expect(body.statusMessage).toContain('repos');
    });

    test('accepts mounts as object array', async ({ request }) => {
      const container = await createWorker(request, {
        mounts: [{ source: '/tmp/test-agentor', target: '/mnt/test', readOnly: true }],
      });
      createdContainerIds.push(container.id);
      expect(container.id).toBeTruthy();
    });

    test('accepts repos as object array', async ({ request }) => {
      const container = await createWorker(request, {
        repos: [{ provider: 'github', url: 'https://github.com/octocat/Hello-World' }],
      });
      createdContainerIds.push(container.id);
      expect(container.id).toBeTruthy();
    });

    test('accepts valid cpuLimit', async ({ request }) => {
      const container = await createWorker(request, { cpuLimit: 2 });
      createdContainerIds.push(container.id);
      expect(container.id).toBeTruthy();
    });

    test('accepts memoryLimit string', async ({ request }) => {
      const container = await createWorker(request, { memoryLimit: '2g' });
      createdContainerIds.push(container.id);
      expect(container.id).toBeTruthy();
    });

    test('accepts initScript', async ({ request }) => {
      const container = await createWorker(request, { initScript: '#!/bin/bash\necho "hello"' });
      createdContainerIds.push(container.id);
      expect(container.id).toBeTruthy();
    });

    test('accepts environmentId', async ({ request }) => {
      const api = new ApiClient(request);
      // Create an environment first
      const { body: env } = await api.createEnvironment({ name: `ContainerEnvTest-${Date.now()}` });
      try {
        const container = await createWorker(request, { environmentId: env.id });
        createdContainerIds.push(container.id);
        expect(container.id).toBeTruthy();
      } finally {
        await api.deleteEnvironment(env.id);
      }
    });

    test('accepts explicit name', async ({ request }) => {
      const api = new ApiClient(request);
      const customName = `custom-name-${Date.now()}`;
      const { status, body } = await api.createContainer({ name: customName });
      expect(status).toBe(201);
      expect(body.name).toContain(customName);
      createdContainerIds.push(body.id);
    });
  });

  test.describe('POST /api/containers/:id/stop', () => {
    test('stops a running container', async ({ request }) => {
      const container = await createWorker(request);
      createdContainerIds.push(container.id);

      const api = new ApiClient(request);
      const { status, body } = await api.stopContainer(container.id);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);

      // Verify it's stopped
      const { body: containers } = await api.listContainers();
      const found = containers.find((c: { id: string }) => c.id === container.id);
      expect(found.status).toBe('stopped');
    });

    test('stopping non-existent container returns error', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.stopContainer('non-existent-id');
      expect(status).toBeGreaterThanOrEqual(400);
    });
  });

  test.describe('POST /api/containers/:id/restart', () => {
    test('restarts a stopped container', async ({ request }) => {
      const container = await createWorker(request);
      createdContainerIds.push(container.id);

      const api = new ApiClient(request);
      await api.stopContainer(container.id);
      await new Promise(r => setTimeout(r, 1000));

      const { status, body } = await api.restartContainer(container.id);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
    });

    test('restarting non-existent container returns error', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.restartContainer('non-existent-id');
      expect(status).toBeGreaterThanOrEqual(400);
    });
  });

  test.describe('DELETE /api/containers/:id', () => {
    test('removes a container', async ({ request }) => {
      const container = await createWorker(request);
      // Don't add to cleanup list since we're explicitly removing

      const api = new ApiClient(request);
      await api.stopContainer(container.id);
      await new Promise(r => setTimeout(r, 1000));

      const { status, body } = await api.removeContainer(container.id);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);

      // Verify it's gone
      const { body: containers } = await api.listContainers();
      const found = containers.find((c: { id: string }) => c.id === container.id);
      expect(found).toBeUndefined();
    });
  });

  test.describe('DELETE /api/containers/:id (error handling)', () => {
    test('deleting non-existent container returns error', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.removeContainer('non-existent-id');
      expect(status).toBeGreaterThanOrEqual(400);
    });
  });

  test.describe('POST /api/containers/:id/archive', () => {
    test('archives a container', async ({ request }) => {
      const container = await createWorker(request);

      const api = new ApiClient(request);
      const { status, body } = await api.archiveContainer(container.id);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);

      // Verify it's gone from active containers
      const { body: containers } = await api.listContainers();
      const found = containers.find((c: { id: string }) => c.id === container.id);
      expect(found).toBeUndefined();

      // Verify it's in archived list
      const { body: archived } = await api.listArchived();
      const archivedWorker = archived.find((w: { name: string }) => w.name === container.name);
      expect(archivedWorker).toBeTruthy();

      // Cleanup: delete archived worker
      await api.deleteArchivedWorker(container.name);
    });

    test('archiving non-existent container returns error', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.archiveContainer('non-existent-id');
      expect(status).toBeGreaterThanOrEqual(400);
    });
  });

  test.describe('GET /api/containers/:id/logs', () => {
    test('returns container logs', async ({ request }) => {
      const container = await createWorker(request);
      createdContainerIds.push(container.id);

      const api = new ApiClient(request);
      const { status, body } = await api.getContainerLogs(container.id);
      expect(status).toBe(200);
      expect(typeof body.logs).toBe('string');
    });

    test('respects tail parameter', async ({ request }) => {
      const container = await createWorker(request);
      createdContainerIds.push(container.id);

      const api = new ApiClient(request);
      const { status, body } = await api.getContainerLogs(container.id, 10);
      expect(status).toBe(200);
      expect(typeof body.logs).toBe('string');
    });

    test('logs on non-existent container fails', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.getContainerLogs('non-existent-id');
      expect(status).toBeGreaterThanOrEqual(400);
    });

    test('logs on stopped container still returns logs', async ({ request }) => {
      const container = await createWorker(request);
      createdContainerIds.push(container.id);

      const api = new ApiClient(request);
      await api.stopContainer(container.id);
      await new Promise(r => setTimeout(r, 1000));

      const { status, body } = await api.getContainerLogs(container.id);
      expect(status).toBe(200);
      expect(typeof body.logs).toBe('string');
    });

    test('logs response contains non-empty string for running container', async ({ request }) => {
      const container = await createWorker(request);
      createdContainerIds.push(container.id);

      const api = new ApiClient(request);
      const { body } = await api.getContainerLogs(container.id);
      expect(body.logs.length).toBeGreaterThan(0);
    });
  });

  test.describe('GET /api/containers/:id/logs (edge cases)', () => {
    test('non-numeric tail parameter defaults gracefully', async ({ request }) => {
      const container = await createWorker(request);
      createdContainerIds.push(container.id);

      const api = new ApiClient(request);
      // Pass a non-numeric tail — handler should default to 200, not error
      const res = await request.get(
        `${api.baseUrl}/api/containers/${container.id}/logs?tail=abc`,
      );
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(typeof body.logs).toBe('string');
    });
  });

  test.describe('State transitions', () => {
    test('stopping already-stopped container returns error', async ({ request }) => {
      const container = await createWorker(request);
      createdContainerIds.push(container.id);

      const api = new ApiClient(request);
      await api.stopContainer(container.id);
      // Stop again — Docker rejects stopping an already-stopped container
      const { status } = await api.stopContainer(container.id);
      expect(status).toBeGreaterThanOrEqual(400);
    });

    test('restarting a running container succeeds', async ({ request }) => {
      const container = await createWorker(request);
      createdContainerIds.push(container.id);

      const api = new ApiClient(request);
      const { status, body } = await api.restartContainer(container.id);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
    });

    test('archiving a stopped container succeeds', async ({ request }) => {
      const container = await createWorker(request);
      const api = new ApiClient(request);
      await api.stopContainer(container.id);
      await new Promise(r => setTimeout(r, 1000));

      const { status, body } = await api.archiveContainer(container.id);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);

      await api.deleteArchivedWorker(container.name);
    });
  });

  test.describe('Response completeness', () => {
    test('displayName persists in container list', async ({ request }) => {
      const name = `Persist-${Date.now()}`;
      const container = await createWorker(request, { displayName: name });
      createdContainerIds.push(container.id);

      const api = new ApiClient(request);
      const { body } = await api.listContainers();
      const found = body.find((c: { id: string }) => c.id === container.id);
      expect(found).toBeTruthy();
      expect(found.displayName).toBe(name);
    });

    test('container list excludes archived containers', async ({ request }) => {
      const container = await createWorker(request);
      const api = new ApiClient(request);
      await api.archiveContainer(container.id);

      const { body } = await api.listContainers();
      const found = body.find((c: { name: string }) => c.name === container.name);
      expect(found).toBeUndefined();

      await api.deleteArchivedWorker(container.name);
    });

    test('create with initScript sets custom startup', async ({ request }) => {
      const container = await createWorker(request, {
        displayName: `Init-${Date.now()}`,
        initScript: '#!/bin/bash\necho hello',
      });
      createdContainerIds.push(container.id);

      expect(container.id).toBeTruthy();
      expect(container.status).toBe('running');
    });

    test('create response includes expected fields', async ({ request }) => {
      const container = await createWorker(request, { displayName: 'FieldsCheck' });
      createdContainerIds.push(container.id);

      expect(typeof container.id).toBe('string');
      expect(typeof container.name).toBe('string');
      expect(container.status).toBe('running');
      expect(container.displayName).toBe('FieldsCheck');
      expect(typeof container.image).toBe('string');
    });
  });
});
