import { test, expect, request as playwrightRequest } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';
import { runInFreshWindow } from '../helpers/terminal-ws';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const UNAUTH_OPTS = {
  baseURL: BASE_URL,
  extraHTTPHeaders: { Origin: BASE_URL },
  storageState: { cookies: [], origins: [] },
};

test.describe('Worker metrics API', () => {
  test('GET /api/worker-metrics returns a workers array', async ({ request }) => {
    const api = new ApiClient(request);
    const { status, body } = await api.getWorkerMetrics();
    expect(status).toBe(200);
    expect(Array.isArray(body.workers)).toBe(true);
  });

  test('GET /api/worker-metrics requires auth', async () => {
    const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
    try {
      const api = new ApiClient(ctx);
      const { status } = await api.getWorkerMetrics();
      expect(status).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test('POST /api/worker-metrics/refresh returns a workers array', async ({ request }) => {
    const api = new ApiClient(request);
    const { status, body } = await api.refreshWorkerMetrics();
    expect(status).toBe(200);
    expect(Array.isArray(body.workers)).toBe(true);
  });

  test('POST /api/worker-metrics/refresh requires auth', async () => {
    const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
    try {
      const api = new ApiClient(ctx);
      const { status } = await api.refreshWorkerMetrics();
      expect(status).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });
});

test.describe('Per-worker metrics API', () => {
  let workerId: string;

  test.beforeAll(async ({ request }) => {
    const w = await createWorker(request);
    workerId = w.id;
  });

  test.afterAll(async ({ request }) => {
    if (workerId) await cleanupWorker(request, workerId);
  });

  test('GET /api/containers/:id/metrics returns a metrics snapshot', async ({ request }) => {
    const api = new ApiClient(request);
    const { status, body } = await api.getContainerMetrics(workerId);
    expect(status).toBe(200);
    expect(body.workerId).toBe(workerId);
    expect(body.containerName).toContain('agentor-worker-');
    expect(typeof body.cpuUtilization).toBe('number');
    expect(typeof body.memoryUsedBytes).toBe('number');
    expect(typeof body.memoryUtilization).toBe('number');
    expect(typeof body.diskUsedBytes).toBe('number');
    expect(typeof body.netRxBytesPerSec).toBe('number');
    expect(typeof body.lastChecked).toBe('string');
  });

  test('worker disk usage (writable layer + volumes) is non-zero after a forced sample', async ({ request }) => {
    test.setTimeout(60_000);
    const api = new ApiClient(request);
    // Disk samples on a slow cadence; the refresh endpoint forces an immediate
    // sample (du of the volumes + the container's SizeRw writable layer).
    await api.refreshWorkerMetrics();
    const { status, body } = await api.getContainerMetrics(workerId);
    expect(status).toBe(200);
    // A running worker always uses some disk (agent-data configs + writable layer).
    expect(body.diskUsedBytes).toBeGreaterThan(0);
  });

  test('worker disk counts the container writable layer, not just volumes', async ({ request }) => {
    test.setTimeout(150_000);
    const api = new ApiClient(request);
    await api.refreshWorkerMetrics();
    const before = (await api.getContainerMetrics(workerId)).body.diskUsedBytes as number;

    // Write 40 MB to a path in the container's WRITABLE LAYER (/home/agent is not
    // a volume — only /home/agent/.agent-data is). The `du` of the volumes won't
    // see this; only the SizeRw writable-layer measurement will. Match on the
    // shell-computed file size (not the echoed command literal).
    await runInFreshWindow(
      request,
      workerId,
      'dd if=/dev/zero of=/home/agent/.disktest bs=1M count=40 2>/dev/null; echo "SZ=$(stat -c %s /home/agent/.disktest)"',
      /SZ=\d{7,}/,
      60_000,
    );

    await api.refreshWorkerMetrics();
    const after = (await api.getContainerMetrics(workerId)).body.diskUsedBytes as number;
    // The 40 MB writable-layer file must be reflected — proves SizeRw is counted.
    expect(after - before).toBeGreaterThan(30 * 1024 * 1024);
  });

  test('GET /api/containers/:id/metrics 404 for an unknown worker', async ({ request }) => {
    const api = new ApiClient(request);
    const { status } = await api.getContainerMetrics('00000000-0000-0000-0000-000000000000');
    expect(status).toBe(404);
  });

  test('per-worker metrics requires auth', async () => {
    const ctx = await playwrightRequest.newContext(UNAUTH_OPTS);
    try {
      const api = new ApiClient(ctx);
      const { status } = await api.getContainerMetrics(workerId);
      expect(status).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test('worker appears in /api/worker-metrics once sampled', async ({ request }) => {
    test.setTimeout(60_000);
    const api = new ApiClient(request);
    // The monitor samples every ~3s; poll for the worker to appear.
    let found: { cpuUtilization: number; containerName: string } | undefined;
    const start = Date.now();
    while (Date.now() - start < 30_000) {
      const { body } = await api.getWorkerMetrics();
      found = (body.workers || []).find((m: { workerId: string }) => m.workerId === workerId);
      if (found) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    expect(found).toBeTruthy();
    expect(typeof found!.cpuUtilization).toBe('number');
    expect(found!.containerName).toContain('agentor-worker-');
  });
});
