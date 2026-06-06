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
      expect(typeof found.containerId).toBe('string');
      expect(typeof found.containerName).toBe('string');
      expect(typeof found.status).toBe('string');
      expect(typeof found.createdAt).toBe('string');
      expect(typeof found.imageName).toBe('string');
      expect(typeof found.imageId).toBe('string');
      expect(found.imageName).toBeTruthy();
    });
  });

  test.describe('GET /api/containers/generate-name (suggest display name)', () => {
    test('returns a suggested display name', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.generateName();
      expect(status).toBe(200);
      expect(typeof body.displayName).toBe('string');
      expect(body.displayName.length).toBeGreaterThan(0);
    });

    test('suggests unique display names', async ({ request }) => {
      const api = new ApiClient(request);
      const names = new Set<string>();
      for (let i = 0; i < 5; i++) {
        const { body } = await api.generateName();
        names.add(body.displayName);
      }
      // All 5 suggestions should be unique
      expect(names.size).toBe(5);
    });

    test('suggested display name is an adjective-animal slug', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.generateName();
      // Suggestion is a friendly adjective-animal slug (lowercase, dashes).
      // It is only a default — users may type any free-form display name.
      expect(body.displayName).toMatch(/^[a-z]+-[a-z]+$/);
    });
  });

  test.describe('POST /api/containers', () => {
    test('creates a container and returns 201', async ({ request }) => {
      const container = await createWorker(request);
      createdContainerIds.push(container.id);
      expect(container.id).toBeTruthy();
      expect(container.status).toBe('running');
    });

    test('creates a container with a display name', async ({ request }) => {
      const container = await createWorker(request, { displayName: 'Test Worker' });
      createdContainerIds.push(container.id);
      expect(container.displayName).toBe('Test Worker');
      // `id` is always a server-minted UUID v4 regardless of the label.
      expect(container.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    test('creates a container with dockerEnabled', async ({ request }) => {
      const container = await createWorker(request, { dockerEnabled: true });
      createdContainerIds.push(container.id);
      expect(container.id).toBeTruthy();
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

    test('rejects a mount source containing a colon (option injection)', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.createContainer({
        mounts: [{ source: '/tmp/test-agentor:rshared', target: '/mnt/test' }],
      });
      expect(status).toBe(400);
      expect(body.statusMessage).toContain(':');
    });

    test('rejects a mount target containing a colon (option injection)', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.createContainer({
        mounts: [{ source: '/tmp/test-agentor', target: '/mnt/test:Z' }],
      });
      expect(status).toBe(400);
      expect(body.statusMessage).toContain(':');
    });

    test('rejects mounting the Docker socket', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.createContainer({
        mounts: [{ source: '/var/run/docker.sock', target: '/var/run/docker.sock' }],
      });
      expect(status).toBe(400);
      expect(body.statusMessage).toContain('Docker socket');
    });

    test('rejects mounting the orchestrator data directory', async ({ request }) => {
      const api = new ApiClient(request);
      // /data is the default DATA_DIR — its subtree holds other users' data.
      const { status, body } = await api.createContainer({
        mounts: [{ source: '/data/users', target: '/mnt/steal' }],
      });
      expect(status).toBe(400);
      expect(body.statusMessage).toContain('data directory');
    });

    test('accepts repos as object array', async ({ request }) => {
      const container = await createWorker(request, {
        repos: [{ provider: 'github', url: 'https://github.com/octocat/Hello-World' }],
      });
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

    test('accepts explicit displayName; id is a server-minted UUID', async ({ request }) => {
      const api = new ApiClient(request);
      const customLabel = `custom-label-${Date.now()}`;
      const { status, body } = await api.createContainer({ displayName: customLabel });
      expect(status).toBe(201);
      // The user value lands in displayName...
      expect(body.displayName).toBe(customLabel);
      // ...while `id` is an opaque UUID v4 that never contains the label.
      expect(body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(body.id).not.toContain(customLabel);
      createdContainerIds.push(body.id);
    });
  });

  test.describe('PATCH /api/containers/:id (rename)', () => {
    const WORKER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const renameContainerIds: string[] = [];

    test.afterAll(async ({ request }) => {
      for (const id of renameContainerIds) {
        await cleanupWorker(request, id);
      }
      renameContainerIds.length = 0;
    });

    test('rename updates displayName and leaves id unchanged', async ({ request }) => {
      const api = new ApiClient(request);
      const worker = await createWorker(request, { displayName: 'before-rename' });
      renameContainerIds.push(worker.id);

      const originalId = worker.id;
      const newLabel = `renamed-${Date.now()}`;
      const { status, body } = await api.renameContainer(worker.id, newLabel);
      expect(status).toBe(200);
      expect(body.displayName).toBe(newLabel);
      // The UUID `id` is immutable across a rename.
      expect(body.id).toBe(originalId);
      expect(body.id).toMatch(WORKER_ID);
    });

    test('rename persists in the container list', async ({ request }) => {
      const api = new ApiClient(request);
      const worker = await createWorker(request, { displayName: 'list-before' });
      renameContainerIds.push(worker.id);

      const newLabel = `list-after-${Date.now()}`;
      const { status } = await api.renameContainer(worker.id, newLabel);
      expect(status).toBe(200);

      const { body: containers } = await api.listContainers();
      const found = containers.find((c: { id: string }) => c.id === worker.id);
      expect(found).toBeTruthy();
      expect(found.displayName).toBe(newLabel);
    });

    test('rename does not change id or containerName', async ({ request }) => {
      const api = new ApiClient(request);
      const worker = await createWorker(request, { displayName: 'identity-before' });
      renameContainerIds.push(worker.id);

      const { status, body } = await api.renameContainer(worker.id, `identity-after-${Date.now()}`);
      expect(status).toBe(200);
      expect(body.id).toBe(worker.id);
      expect(body.containerName).toBe(worker.containerName);
    });

    test('rejects empty/whitespace displayName with 400', async ({ request }) => {
      const api = new ApiClient(request);
      const worker = await createWorker(request, { displayName: 'keep-me' });
      renameContainerIds.push(worker.id);

      const empty = await api.renameContainer(worker.id, '');
      expect(empty.status).toBe(400);

      const whitespace = await api.renameContainer(worker.id, '   ');
      expect(whitespace.status).toBe(400);
    });

    test('rejects displayName longer than 100 chars with 400', async ({ request }) => {
      const api = new ApiClient(request);
      const worker = await createWorker(request, { displayName: 'keep-me-too' });
      renameContainerIds.push(worker.id);

      const tooLong = 'x'.repeat(101);
      const { status } = await api.renameContainer(worker.id, tooLong);
      expect(status).toBe(400);
    });

    test('rename on non-existent container returns 404', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.renameContainer('non-existent-id', 'whatever');
      expect(status).toBe(404);
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
      const archivedWorker = archived.find((w: { id: string }) => w.id === container.id);
      expect(archivedWorker).toBeTruthy();

      // Cleanup: delete archived worker
      await api.deleteArchivedWorker(container.id);
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
      // Worker output trickles into the docker log buffer asynchronously
      // (the loading screen prints frames, then the entrypoint writes its
      // own logs). On slower I/O — particularly nested DinD — the buffer
      // can still be empty the very first time we ask, so poll briefly.
      let body: { logs: string } = { logs: '' };
      for (let i = 0; i < 20; i++) {
        ({ body } = await api.getContainerLogs(container.id));
        if (body.logs.length > 0) break;
        await new Promise((r) => setTimeout(r, 250));
      }
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

      await api.deleteArchivedWorker(container.id);
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
      // The internal `id` stays a UUID; the editable label is displayName.
      expect(found.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    test('container list excludes archived containers', async ({ request }) => {
      const container = await createWorker(request);
      const api = new ApiClient(request);
      await api.archiveContainer(container.id);

      const { body } = await api.listContainers();
      const found = body.find((c: { id: string }) => c.id === container.id);
      expect(found).toBeUndefined();

      await api.deleteArchivedWorker(container.id);
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
      expect(container.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(container.status).toBe('running');
      expect(container.displayName).toBe('FieldsCheck');
      expect(typeof container.imageName).toBe('string');
    });
  });

  test.describe('Snapshotted environment fields', () => {
    test('container list includes mounts when created with mounts', async ({ request }) => {
      const container = await createWorker(request, {
        mounts: [{ source: '/tmp/test-agentor-mounts', target: '/mnt/test', readOnly: true }],
      });
      createdContainerIds.push(container.id);

      const api = new ApiClient(request);
      const { body } = await api.listContainers();
      const found = body.find((c: { id: string }) => c.id === container.id);
      expect(found).toBeTruthy();
      expect(Array.isArray(found.mounts)).toBe(true);
      expect(found.mounts).toHaveLength(1);
      expect(found.mounts[0].source).toBe('/tmp/test-agentor-mounts');
      expect(found.mounts[0].target).toBe('/mnt/test');
      expect(found.mounts[0].readOnly).toBe(true);
    });

    test('container list includes initScript when created with initScript', async ({ request }) => {
      const script = '#!/bin/bash\necho "snapshot-test"';
      const container = await createWorker(request, { initScript: script });
      createdContainerIds.push(container.id);

      const api = new ApiClient(request);
      const { body } = await api.listContainers();
      const found = body.find((c: { id: string }) => c.id === container.id);
      expect(found).toBeTruthy();
      expect(found.initScript).toBe(script);
    });

    // Environment config (CPU/memory/network/docker/setup/env vars/exposed APIs/
    // capabilities/instructions) and git identity are NOT copied onto the worker —
    // the worker stores only the `environmentId` FK and resolves the rest live.
    const ENV_CONFIG_KEYS = [
      'environmentName', 'cpuLimit', 'memoryLimit', 'networkMode', 'dockerEnabled',
      'allowedDomains', 'includePackageManagerDomains', 'setupScript', 'envVars',
      'exposeApis', 'capabilityNames', 'instructionNames', 'gitName', 'gitEmail',
    ];

    test('container references environment by id only — no snapshotted env config', async ({ request }) => {
      const api = new ApiClient(request);

      // An environment with distinctive, non-default config.
      const { status: envStatus, body: env } = await api.createEnvironment({
        name: `NormEnv-${Date.now()}`,
        networkMode: 'custom',
        allowedDomains: ['example.com', 'api.example.com'],
        includePackageManagerDomains: true,
        setupScript: '#!/bin/bash\napt-get update',
        envVars: 'MY_VAR=hello\nANOTHER=world',
        exposeApis: { portMappings: false, domainMappings: true, usage: false },
        dockerEnabled: false,
        cpuLimit: 2,
        memoryLimit: '2g',
      });
      expect(envStatus).toBe(201);

      try {
        const container = await createWorker(request, { environmentId: env.id });
        createdContainerIds.push(container.id);

        // Create response references the env by id only — none of the env config
        // (nor git identity) is present on the worker.
        expect(container.environmentId).toBe(env.id);
        for (const k of ENV_CONFIG_KEYS) expect(container[k]).toBeUndefined();

        // The list view is likewise normalized.
        const { body: containers } = await api.listContainers();
        const found = containers.find((c: { id: string }) => c.id === container.id);
        expect(found).toBeTruthy();
        expect(found.environmentId).toBe(env.id);
        for (const k of ENV_CONFIG_KEYS) expect(found[k]).toBeUndefined();
      } finally {
        await api.deleteEnvironment(env.id);
      }
    });

    test('worker with the default environment also stores no env config', async ({ request }) => {
      const container = await createWorker(request);
      createdContainerIds.push(container.id);

      const api = new ApiClient(request);
      const { body } = await api.listContainers();
      const found = body.find((c: { id: string }) => c.id === container.id);
      expect(found).toBeTruthy();
      for (const k of ENV_CONFIG_KEYS) expect(found[k]).toBeUndefined();
    });
  });
});
