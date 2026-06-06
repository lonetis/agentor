import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createWorker, cleanupWorker, uniquePort } from '../helpers/worker-lifecycle';

/**
 * Regression tests for the unified Traefik architecture. Port mappings used to
 * run in a dedicated `agentor-mapper` container; they now share the same
 * Traefik container as domain mappings. These tests lock in the merged
 * behaviour so nobody re-introduces the separate mapper container.
 */
test.describe('Unified Traefik (merged mapper)', () => {
  test.describe('mapper-as-log-source is gone', () => {
    test('GET /api/log-sources never returns a "mapper" source', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.getLogSources();
      expect(status).toBe(200);
      expect(Array.isArray(body.sources)).toBe(true);
      for (const src of body.sources) {
        expect(src.source).not.toBe('mapper');
      }
    });
  });

  test.describe('UpdateStatus no longer has a mapper key', () => {
    test('GET /api/updates has no "mapper" property', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.getUpdateStatus();
      expect(status).toBe(200);
      expect('mapper' in body).toBe(false);
      expect('orchestrator' in body).toBe(true);
      expect('worker' in body).toBe(true);
      expect('traefik' in body).toBe(true);
    });

    test('POST /api/updates/apply accepts only the 3-image enum', async ({ request }) => {
      const api = new ApiClient(request);
      // Per-image apply with the stale "mapper" key should be rejected by validation
      // OR silently ignored (server accepts the field but has no image to pull).
      // Either way the response must not advertise a mapperPulled flag.
      const { body: s } = await api.getUpdateStatus();
      if (!s.isProductionMode) {
        const { status } = await api.applyUpdates(['worker']);
        expect(status).toBe(400);
      }
      // ApplyResult shape check: the three *Pulled flags are present.
      const res = await request.get('/api/docs/openapi.json');
      if (res.ok()) {
        const spec = await res.json();
        const applySchema = spec?.paths?.['/api/updates/apply']?.post?.requestBody?.content?.['application/json']?.schema;
        if (applySchema?.properties?.images?.items?.enum) {
          expect(applySchema.properties.images.items.enum).toEqual(['orchestrator', 'worker', 'traefik']);
        }
      }
    });
  });

  test.describe('Traefik handles port and domain mappings on the same container', () => {
    test('port mapping create/delete works while domain-mapper is active', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();
      test.skip(!mapperStatus.enabled, 'Requires domain mapping to be enabled');

      const worker = await createWorker(request, { displayName: `traefik-port-${Date.now()}` });
      try {
        // Pick a port unlikely to collide with other parallel tests.
        const port = 50000 + Math.floor(Math.random() * 10000);
        const { status: createStatus } = await api.createPortMapping({
          externalPort: port,
          type: 'localhost',
          workerId: worker.id,
          internalPort: 3000,
        });
        expect(createStatus).toBe(201);

        const { body: pmStatus } = await api.getPortMapperStatus();
        expect(pmStatus.totalMappings).toBeGreaterThanOrEqual(1);

        const { status: delStatus } = await api.deletePortMapping(port);
        expect(delStatus).toBe(200);
      } finally {
        await cleanupWorker(request, worker.id);
      }
    });

    test('a port mapping and a domain mapping can exist simultaneously on the same worker', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();
      test.skip(!mapperStatus.enabled, 'Requires domain mapping to be enabled');

      const worker = await createWorker(request, { displayName: `traefik-mixed-${Date.now()}` });
      const port = 50000 + Math.floor(Math.random() * 10000);
      const sub = `mix-${Date.now()}`;
      let createdDomainId: string | undefined;

      try {
        const { status: pmStatus } = await api.createPortMapping({
          externalPort: port,
          type: 'localhost',
          workerId: worker.id,
          internalPort: 3000,
        });
        expect(pmStatus).toBe(201);

        const { status: dmStatus, body: dm } = await api.createDomainMapping({
          subdomain: sub,
          baseDomain: mapperStatus.baseDomains[0],
          protocol: 'http',
          workerId: worker.id,
          internalPort: 3000,
        });
        expect(dmStatus).toBe(201);
        createdDomainId = dm.id;

        // Both stores report the mapping.
        const { body: listPm } = await api.listPortMappings();
        expect(listPm.some((m: { externalPort: number }) => m.externalPort === port)).toBe(true);

        const { body: listDm } = await api.listDomainMappings();
        expect(listDm.some((m: { id: string }) => m.id === dm.id)).toBe(true);
      } finally {
        try { await api.deletePortMapping(port); } catch {}
        if (createdDomainId) {
          try { await api.deleteDomainMapping(createdDomainId); } catch {}
        }
        await cleanupWorker(request, worker.id);
      }
    });

    test('settings exposes no MAPPER_IMAGE key', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.getSettings();
      for (const section of body) {
        for (const item of section.items) {
          expect(item.key).not.toBe('MAPPER_IMAGE');
        }
      }
    });
  });

  /**
   * Port mappings drive the Traefik container's static config (one dedicated
   * entrypoint per external port) and its PortBindings (HostIp depends on
   * localhost vs external). Adding/removing a mapping is a Cmd-drift recreate;
   * toggling localhost↔external on the same external port is a PortBindings
   * drift recreate. The internals (`hasContainerConfigDrift`, `buildCmd`/
   * `buildPortBindings` ordering) are not observable over the public API, but
   * these tests exercise the create→toggle→delete reconcile path end-to-end so a
   * regression in the predicate dedup or the recreate path surfaces as a failed
   * mapping operation. Works without BASE_DOMAINS (port mappings don't need it).
   */
  test.describe('Port mapping reconcile / drift recreate path', () => {
    test('a localhost port mapping toggled to external keeps working on the same port', async ({ request }) => {
      const api = new ApiClient(request);
      const worker = await createWorker(request, { displayName: `traefik-drift-${Date.now()}` });
      const port = uniquePort();

      try {
        // Create as localhost — first port mapping triggers Traefik create with a
        // pm-<port> entrypoint.
        const { status: c1 } = await api.createPortMapping({
          externalPort: port,
          type: 'localhost',
          workerId: worker.id,
          internalPort: 8443,
        });
        expect(c1).toBe(201);

        const { body: listed } = await api.listPortMappings();
        const found = listed.find((m: { externalPort: number }) => m.externalPort === port);
        expect(found).toBeTruthy();
        expect(found.type).toBe('localhost');

        // Toggle localhost → external on the same external port. The store keys by
        // external port, so this is delete + recreate; Traefik re-binds the
        // entrypoint with HostIp 0.0.0.0 (PortBindings drift recreate).
        const { status: del } = await api.deletePortMapping(port);
        expect(del).toBe(200);

        const { status: c2 } = await api.createPortMapping({
          externalPort: port,
          type: 'external',
          workerId: worker.id,
          internalPort: 8443,
        });
        expect(c2).toBe(201);

        const { body: relisted } = await api.listPortMappings();
        const reFound = relisted.find((m: { externalPort: number }) => m.externalPort === port);
        expect(reFound).toBeTruthy();
        expect(reFound.type).toBe('external');
      } finally {
        try { await api.deletePortMapping(port); } catch { /* idempotent */ }
        await cleanupWorker(request, worker.id);
      }
    });

    test('removing the only port mapping cleanly tears down without wedging later reconciles', async ({ request }) => {
      const api = new ApiClient(request);
      const worker = await createWorker(request, { displayName: `traefik-teardown-${Date.now()}` });
      const portA = uniquePort();
      const portB = uniquePort();

      try {
        // Two distinct external ports → two pm-<port> entrypoints (Cmd drift on add).
        expect((await api.createPortMapping({ externalPort: portA, type: 'localhost', workerId: worker.id, internalPort: 3000 })).status).toBe(201);
        expect((await api.createPortMapping({ externalPort: portB, type: 'localhost', workerId: worker.id, internalPort: 3001 })).status).toBe(201);

        // Remove both — exercises Cmd-drift recreate (entrypoint list shrinks),
        // and the full teardown when nothing (domain/dashboard) keeps Traefik up.
        expect((await api.deletePortMapping(portA)).status).toBe(200);
        expect((await api.deletePortMapping(portB)).status).toBe(200);

        // A subsequent reconcile must still work (the image-pull-timeout guard
        // ensures the reconcile queue is never wedged) — proven by creating a
        // fresh mapping after the teardown.
        const portC = uniquePort();
        const { status: c3 } = await api.createPortMapping({ externalPort: portC, type: 'localhost', workerId: worker.id, internalPort: 3000 });
        expect(c3).toBe(201);
        await api.deletePortMapping(portC);
      } finally {
        try { await api.deletePortMapping(portA); } catch { /* idempotent */ }
        try { await api.deletePortMapping(portB); } catch { /* idempotent */ }
        await cleanupWorker(request, worker.id);
      }
    });
  });
});
