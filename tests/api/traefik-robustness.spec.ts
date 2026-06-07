import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';

// Regression suite for the "a bad port/domain mapping wedges Traefik and locks
// me out of the dashboard" failure. The mapping-create path now (1) reserves
// Traefik's own 80/443 web entrypoints, (2) pre-flights host ports and rolls
// Traefik back to its last-good config on a failed apply, and (3) rolls the
// offending mapping back out of the store and returns 409 — so a misconfig is
// rejected cleanly instead of taking the dashboard down.

let _portCounter = 0;
function uniquePort(): number {
  const base = 11000 + Math.floor(Math.random() * 40000);
  return base + (_portCounter++ % 9000);
}

test.describe('Traefik robustness against port-mapping misconfig', () => {
  let containerId: string;
  let containerDockerName: string;

  test.beforeAll(async ({ request }) => {
    const container = await createWorker(request);
    containerId = container.id;
    containerDockerName = container.containerName as string;
  });

  test.afterAll(async ({ request }) => {
    const api = new ApiClient(request);
    const { body: mappings } = await api.listPortMappings();
    for (const m of mappings) {
      if (m.containerName === containerDockerName) {
        try { await api.deletePortMapping(m.externalPort); } catch { /* ignore */ }
      }
    }
    await cleanupWorker(request, containerId);
  });

  // Whether Traefik's 80/443 web entrypoints are active. They only exist (and
  // are therefore reserved) when domain routing / the dashboard runs through
  // Traefik — signalled by a configured dashboardUrl.
  async function webEntrypointsActive(api: ApiClient): Promise<boolean> {
    const { body } = await api.getDomainMapperStatus();
    return !!body?.dashboardUrl;
  }

  for (const reserved of [80, 443]) {
    test(`rejects a port mapping on reserved web-entrypoint port ${reserved} with 409`, async ({ request }) => {
      const api = new ApiClient(request);
      test.skip(!(await webEntrypointsActive(api)), 'Web entrypoints (80/443) not active — port is not reserved in this config');

      const { status, body } = await api.createPortMapping({
        externalPort: reserved,
        type: 'external',
        workerId: containerId,
        internalPort: uniquePort(),
      });

      expect(status).toBe(409);
      const msg = JSON.stringify(body).toLowerCase();
      expect(msg).toContain('reserved');

      // No leak: the rejected mapping must not be persisted.
      const { body: mappings } = await api.listPortMappings();
      expect(mappings.some((m: { externalPort: number }) => m.externalPort === reserved)).toBe(false);
    });
  }

  test('a reserved-port rejection does not wedge Traefik — health stays ok and a valid mapping still applies', async ({ request }) => {
    const api = new ApiClient(request);
    test.skip(!(await webEntrypointsActive(api)), 'Web entrypoints (80/443) not active — port is not reserved in this config');

    // A valid mapping applied before the bad attempt.
    const goodPort = uniquePort();
    const before = await api.createPortMapping({
      externalPort: goodPort,
      type: 'localhost',
      workerId: containerId,
      internalPort: uniquePort(),
    });
    expect(before.status).toBe(201);

    // The misconfig that previously took Traefik (and the dashboard) down.
    const bad = await api.createPortMapping({
      externalPort: 80,
      type: 'external',
      workerId: containerId,
      internalPort: uniquePort(),
    });
    expect(bad.status).toBe(409);

    // The orchestrator is still serving, and — crucially — Traefik can still be
    // (re)created for a NEW valid mapping, proving it was never wedged.
    const health = await api.health();
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ok');

    const afterPort = uniquePort();
    const after = await api.createPortMapping({
      externalPort: afterPort,
      type: 'localhost',
      workerId: containerId,
      internalPort: uniquePort(),
    });
    expect(after.status).toBe(201);

    // The earlier valid mapping survived the failed attempt.
    const { body: mappings } = await api.listPortMappings();
    expect(mappings.some((m: { externalPort: number }) => m.externalPort === goodPort)).toBe(true);

    await api.deletePortMapping(goodPort);
    await api.deletePortMapping(afterPort);
  });

  test('duplicate external port is still rejected with 409 and leaves Traefik healthy', async ({ request }) => {
    const api = new ApiClient(request);
    const port = uniquePort();

    const first = await api.createPortMapping({
      externalPort: port,
      type: 'localhost',
      workerId: containerId,
      internalPort: uniquePort(),
    });
    expect(first.status).toBe(201);

    const dup = await api.createPortMapping({
      externalPort: port,
      type: 'localhost',
      workerId: containerId,
      internalPort: uniquePort(),
    });
    expect(dup.status).toBe(409);

    const health = await api.health();
    expect(health.status).toBe(200);

    await api.deletePortMapping(port);
  });
});
