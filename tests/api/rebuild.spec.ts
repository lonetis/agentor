import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createWorker, cleanupWorker, waitForWorkerRunning } from '../helpers/worker-lifecycle';
import { runInFreshWindow } from '../helpers/terminal-ws';

test.describe('POST /api/containers/:id/rebuild', () => {
  const createdContainerIds: string[] = [];

  test.afterEach(async ({ request }) => {
    for (const id of createdContainerIds) {
      await cleanupWorker(request, id);
    }
    createdContainerIds.length = 0;
  });

  test('rebuilds a running container and returns the same worker with a new Docker container', async ({ request }) => {
    const container = await createWorker(request, { displayName: `Rebuild-${Date.now()}` });
    const api = new ApiClient(request);

    const { status, body } = await api.rebuildContainer(container.id);
    expect(status).toBe(200);
    createdContainerIds.push(body.id);

    // Worker identity (id) is STABLE across rebuild — it's the same worker.
    expect(body.id).toBeTruthy();
    expect(body.id).toBe(container.id);

    // But the underlying Docker container is recreated (new containerId).
    expect(body.containerId).toBeTruthy();
    expect(body.containerId).not.toBe(container.containerId);

    // Preserves metadata
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

  test('worker stays under the same id but the Docker container is replaced', async ({ request }) => {
    const container = await createWorker(request);
    const api = new ApiClient(request);

    const { body } = await api.rebuildContainer(container.id);
    createdContainerIds.push(body.id);

    // The worker is still present under the same stable id...
    const { body: containers } = await api.listContainers();
    const found = containers.find((c: { id: string }) => c.id === container.id);
    expect(found).toBeTruthy();
    // ...but the Docker container behind it was recreated.
    expect(found.containerId).toBe(body.containerId);
    expect(found.containerId).not.toBe(container.containerId);
  });

  test('preserves worker id and container name across rebuild', async ({ request }) => {
    const container = await createWorker(request);
    const api = new ApiClient(request);

    const { body } = await api.rebuildContainer(container.id);
    createdContainerIds.push(body.id);

    expect(body.id).toBe(container.id);
    expect(body.containerName).toBe(container.containerName);
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

  test('preserves host bind mounts across rebuild', async ({ request }) => {
    test.setTimeout(240_000);
    // Regression: rebuild() and unarchive() previously did not re-pass `mounts`
    // to createWorkerContainer, silently dropping host bind mounts. The response
    // metadata alone did NOT catch this (it was always set) — so we also verify
    // the bind is actually LIVE in the rebuilt container via /proc/mounts.
    const target = `/mnt/rebuild-mount-${Date.now()}`;
    const container = await createWorker(request, {
      mounts: [{ source: '/tmp', target, readOnly: true }],
    });
    const api = new ApiClient(request);

    const { body } = await api.rebuildContainer(container.id);
    createdContainerIds.push(body.id);

    expect(Array.isArray(body.mounts)).toBe(true);
    expect(body.mounts).toHaveLength(1);
    expect(body.mounts[0].target).toBe(target);
    expect(body.mounts[0].source).toBe('/tmp');

    // The bind must be live in the rebuilt container (count computed at runtime
    // so it cannot leak from the echoed command).
    await waitForWorkerRunning(request, body.id, 120_000);
    const out = await runInFreshWindow(
      request,
      body.id,
      `echo "MNT=$(grep -ca '${target}' /proc/mounts)"`,
      /MNT=\d/,
      60_000,
    );
    const m = out.match(/MNT=(\d)/);
    expect(m, `no computed mount line in:\n${out.slice(-300)}`).toBeTruthy();
    expect(m![1]).toBe('1'); // bind mount active after rebuild
  });

  test('preserves the environment FK across rebuild', async ({ request }) => {
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

      // The worker keeps its environmentId FK; the env config (networkMode etc.)
      // is re-resolved live at rebuild time and not snapshotted onto the worker.
      expect(body.environmentId).toBe(env.id);
      expect(body.networkMode).toBeUndefined();
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

    expect(body.id).toBe(container.id);
    expect(body.containerId).not.toBe(container.containerId);
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
      expect(found.workerId).toBe(container.id);
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
    expect(typeof body.containerId).toBe('string');
    expect(typeof body.status).toBe('string');
    expect(typeof body.createdAt).toBe('string');
    expect(typeof body.imageName).toBe('string');
    // Env config is not snapshotted onto the worker — only the FK is present.
    expect(body.networkMode).toBeUndefined();
    expect(body.exposeApis).toBeUndefined();
  });
});
