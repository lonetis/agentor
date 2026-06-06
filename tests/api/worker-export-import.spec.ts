import { test, expect, request as playwrightRequest } from '@playwright/test';
import zlib from 'node:zlib';
import { ApiClient } from '../helpers/api-client';
import { createWorker, cleanupWorker, waitForWorkerRunning } from '../helpers/worker-lifecycle';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const UNAUTH_OPTS = {
  baseURL: BASE_URL,
  extraHTTPHeaders: { Origin: BASE_URL },
  storageState: { cookies: [], origins: [] },
};

test.describe('Worker export', () => {
  let workerId: string;

  test.beforeAll(async ({ request }) => {
    workerId = (await createWorker(request)).id;
  });

  test.afterAll(async ({ request }) => {
    if (workerId) await cleanupWorker(request, workerId);
  });

  test('streams a tar bundle with manifest + volume tars (no rootfs)', async ({ request }) => {
    const api = new ApiClient(request);
    const { status, headers, body } = await api.exportWorker(workerId, false);
    expect(status).toBe(200);
    expect(headers['content-type']).toContain('application/x-tar');
    expect(headers['content-disposition']).toContain('worker-export.tar');
    expect(body.length).toBeGreaterThan(0);

    // The outer bundle is an uncompressed tar — entry names appear verbatim in
    // the 512-byte headers, so we can assert layout without a tar parser.
    const text = Buffer.from(body).toString('latin1');
    expect(text).toContain('manifest.json');
    expect(text).toContain('workspace.tar.gz');
    expect(text).toContain('agents.tar.gz');
    // includeRootfs=false omits the filesystem snapshot.
    expect(text).not.toContain('rootfs.tar.gz');
  });

  test('export 404 for an unknown worker', async ({ request }) => {
    const api = new ApiClient(request);
    const { status } = await api.exportWorker('00000000-0000-0000-0000-000000000000', false);
    expect(status).toBe(404);
  });

  test('export of a stopped worker still succeeds (running or stopped)', async ({ request }) => {
    const api = new ApiClient(request);
    const worker = await createWorker(request);
    try {
      await api.stopContainer(worker.id);
      const { status } = await api.exportWorker(worker.id, false);
      expect(status).toBe(200);
    } finally {
      await cleanupWorker(request, worker.id);
    }
  });

  test('export of an archived worker is a client error (never a 500)', async ({ request }) => {
    const api = new ApiClient(request);
    const worker = await createWorker(request);
    await api.archiveContainer(worker.id);
    try {
      // An archived worker has no live container — the export endpoint must
      // reject it with a 4xx, not surface a raw 500.
      const { status } = await api.exportWorker(worker.id, false);
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(500);
    } finally {
      await api.deleteArchivedWorker(worker.id);
    }
  });

  test('export requires auth', async () => {
    const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
    try {
      const api = new ApiClient(ctx);
      const { status } = await api.exportWorker(workerId, false);
      expect(status).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });
});

test.describe('Worker import', () => {
  test('rejects an invalid bundle with 400', async ({ request }) => {
    const api = new ApiClient(request);
    const { status } = await api.importWorker(Buffer.from('this is not a tar bundle'));
    expect(status).toBe(400);
  });

  test('requires auth', async () => {
    const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
    try {
      const api = new ApiClient(ctx);
      const { status } = await api.importWorker(Buffer.from('x'.repeat(64)));
      expect(status).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });
});

test.describe.serial('Worker export/import round-trip', () => {
  test('restores the workspace, settings, and a fresh identity', async ({ request }) => {
    test.setTimeout(300_000);
    const api = new ApiClient(request);
    const src = await createWorker(request);
    const marker = `AGENTOR_IMPORT_MARKER_${Date.now()}.txt`;
    let importedId: string | undefined;

    try {
      // Put a uniquely-named file in the source workspace.
      const up = await api.uploadToWorkspace(src.id, [{ name: marker, content: Buffer.from('round-trip-payload') }]);
      expect(up.status).toBe(200);

      // Export (no rootfs — fast) then import as a new worker.
      const exported = await api.exportWorker(src.id, false);
      expect(exported.status).toBe(200);

      const imported = await api.importWorker(Buffer.from(exported.body), 'imported-roundtrip');
      expect(imported.status).toBe(201);
      expect(imported.body.id).toBeTruthy();
      // Fresh identity — never the source id.
      expect(imported.body.id).not.toBe(src.id);
      expect(imported.body.containerName).toBe(`agentor-worker-${imported.body.id}`);
      expect(imported.body.displayName).toBe('imported-roundtrip');
      importedId = imported.body.id;

      await waitForWorkerRunning(request, importedId!, 90_000);

      // The restored workspace must contain the marker file.
      const dl = await api.downloadWorkspace(importedId!);
      expect(dl.status).toBe(200);
      const tar = zlib.gunzipSync(Buffer.from(dl.body)).toString('latin1');
      expect(tar).toContain(marker);
    } finally {
      if (importedId) await cleanupWorker(request, importedId);
      await cleanupWorker(request, src.id);
    }
  });

  test('recreates port mappings for the imported worker', async ({ request }) => {
    test.setTimeout(300_000);
    const api = new ApiClient(request);
    const src = await createWorker(request);
    let importedId: string | undefined;
    let mappedPort: number | undefined;

    try {
      // Add a port mapping, then export.
      const ext = 40000 + Math.floor(Math.random() * 20000);
      const pm = await api.createPortMapping({ externalPort: ext, internalPort: 8080, type: 'localhost', workerId: src.id });
      expect(pm.status).toBe(201);

      const exported = await api.exportWorker(src.id, false);
      expect(exported.status).toBe(200);

      // Remove the source so its external port frees up, then import.
      await cleanupWorker(request, src.id);

      const imported = await api.importWorker(Buffer.from(exported.body), 'imported-with-mapping');
      expect(imported.status).toBe(201);
      importedId = imported.body.id;
      mappedPort = ext;

      await waitForWorkerRunning(request, importedId!, 90_000);

      // The exported mapping is recreated for the new worker (same external port).
      const { body: mappings } = await api.listPortMappings();
      const recreated = mappings.find((m: { externalPort: number; containerName: string }) =>
        m.externalPort === ext && m.containerName === `agentor-worker-${importedId}`);
      expect(recreated).toBeTruthy();
    } finally {
      if (mappedPort) await api.deletePortMapping(mappedPort).catch(() => {});
      if (importedId) await cleanupWorker(request, importedId);
      await cleanupWorker(request, src.id);
    }
  });
});
