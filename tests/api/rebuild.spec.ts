import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createWorker, cleanupWorker, waitForWorkerRunning } from '../helpers/worker-lifecycle';

test.describe('POST /api/containers/:id/rebuild', () => {
  const createdContainerIds: string[] = [];

  test.afterEach(async ({ request }) => {
    for (const id of createdContainerIds) {
      await cleanupWorker(request, id);
    }
    createdContainerIds.length = 0;
  });

  test('rebuilds a running container and returns new ContainerInfo', async ({ request }) => {
    const container = await createWorker(request, { displayName: `Rebuild-${Date.now()}` });
    const api = new ApiClient(request);

    const { status, body } = await api.rebuildContainer(container.id);
    expect(status).toBe(200);
    createdContainerIds.push(body.id);

    // Returns a new container ID (new Docker container)
    expect(body.id).toBeTruthy();
    expect(body.id).not.toBe(container.id);

    // Preserves metadata
    expect(body.name).toBe(container.name);
    expect(body.displayName).toBe(container.displayName);
    expect(body.status).toBe('running');
  });

  test('rebuilt container reaches running state', async ({ request }) => {
    const container = await createWorker(request);
    const api = new ApiClient(request);

    const { body } = await api.rebuildContainer(container.id);
    createdContainerIds.push(body.id);

    await waitForWorkerRunning(request, body.id, 90_000);

    const { body: containers } = await api.listContainers();
    const found = containers.find((c: { id: string }) => c.id === body.id);
    expect(found).toBeTruthy();
    expect(found.status).toBe('running');
  });

  test('old container ID is removed from container list', async ({ request }) => {
    const container = await createWorker(request);
    const api = new ApiClient(request);

    const { body } = await api.rebuildContainer(container.id);
    createdContainerIds.push(body.id);

    const { body: containers } = await api.listContainers();
    const old = containers.find((c: { id: string }) => c.id === container.id);
    expect(old).toBeUndefined();
  });

  test('preserves container name across rebuild', async ({ request }) => {
    const container = await createWorker(request);
    const api = new ApiClient(request);

    const { body } = await api.rebuildContainer(container.id);
    createdContainerIds.push(body.id);

    expect(body.name).toBe(container.name);
  });

  test('preserves displayName across rebuild', async ({ request }) => {
    const displayName = `RebuildName-${Date.now()}`;
    const container = await createWorker(request, { displayName });
    const api = new ApiClient(request);

    const { body } = await api.rebuildContainer(container.id);
    createdContainerIds.push(body.id);

    expect(body.displayName).toBe(displayName);
  });

  test('preserves createdAt timestamp across rebuild', async ({ request }) => {
    const container = await createWorker(request);
    const api = new ApiClient(request);

    const { body } = await api.rebuildContainer(container.id);
    createdContainerIds.push(body.id);

    expect(body.createdAt).toBe(container.createdAt);
  });

  test('preserves initScript across rebuild', async ({ request }) => {
    const initScript = '#!/bin/bash\necho "rebuild-test"';
    const container = await createWorker(request, { initScript });
    const api = new ApiClient(request);

    const { body } = await api.rebuildContainer(container.id);
    createdContainerIds.push(body.id);

    expect(body.initScript).toBe(initScript);
  });

  test('preserves environment config across rebuild', async ({ request }) => {
    const api = new ApiClient(request);
    const { body: env } = await api.createEnvironment({
      name: `RebuildEnv-${Date.now()}`,
      networkMode: 'block',
      setupScript: 'echo rebuild-env',
    });

    try {
      const container = await createWorker(request, { environmentId: env.id });
      const { body } = await api.rebuildContainer(container.id);
      createdContainerIds.push(body.id);

      expect(body.environmentId).toBe(env.id);
      expect(body.networkMode).toBe('block');
    } finally {
      await api.deleteEnvironment(env.id);
    }
  });

  test('rebuilds a stopped container', async ({ request }) => {
    const container = await createWorker(request);
    const api = new ApiClient(request);

    await api.stopContainer(container.id);
    await new Promise(r => setTimeout(r, 1000));

    const { status, body } = await api.rebuildContainer(container.id);
    expect(status).toBe(200);
    createdContainerIds.push(body.id);

    expect(body.id).not.toBe(container.id);
    expect(body.status).toBe('running');
  });

  test('rebuilding non-existent container returns error', async ({ request }) => {
    const api = new ApiClient(request);
    const { status } = await api.rebuildContainer('non-existent-id');
    expect(status).toBeGreaterThanOrEqual(400);
  });

  test('preserves port mappings across rebuild (keyed by containerName)', async ({ request }) => {
    const container = await createWorker(request);
    const api = new ApiClient(request);

    // Create a port mapping with a unique port to avoid parallel collisions
    const port = 10000 + Math.floor(Math.random() * 50000);
    await api.createPortMapping({
      externalPort: port,
      internalPort: 8080,
      type: 'localhost',
      workerId: container.id,
    });

    try {
      const { body } = await api.rebuildContainer(container.id);
      createdContainerIds.push(body.id);

      // Mapping should still exist; containerName is the stable routing key so
      // it does not change across rebuild, while the Docker container id does.
      const { body: mappings } = await api.listPortMappings();
      const found = mappings.find((m: { externalPort: number }) => m.externalPort === port);
      expect(found).toBeTruthy();
      expect(found.workerName).toBe(container.name);
      expect(found.containerName).toBe(container.containerName);
      expect(found.internalPort).toBe(8080);
    } finally {
      await api.deletePortMapping(port);
    }
  });

  test('response includes all expected ContainerInfo fields', async ({ request }) => {
    const container = await createWorker(request, { displayName: `Fields-${Date.now()}` });
    const api = new ApiClient(request);

    const { body } = await api.rebuildContainer(container.id);
    createdContainerIds.push(body.id);

    expect(typeof body.id).toBe('string');
    expect(typeof body.name).toBe('string');
    expect(typeof body.status).toBe('string');
    expect(typeof body.createdAt).toBe('string');
    expect(typeof body.image).toBe('string');
    expect(body.networkMode).toBeTruthy();
    expect(body.exposeApis).toBeTruthy();
  });
});
