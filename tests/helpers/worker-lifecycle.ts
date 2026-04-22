import { APIRequestContext, expect } from '@playwright/test';
import { ApiClient } from './api-client';

let _portCounter = 0;
/**
 * Returns a unique port number in the 10000-59999 range.
 * Combines a random base with a monotonic counter to avoid collisions
 * even when multiple parallel workers call this simultaneously.
 */
export function uniquePort(): number {
  const base = 10000 + Math.floor(Math.random() * 40000);
  return base + (_portCounter++ % 10000);
}

/**
 * Creates a worker container and waits for it to reach 'running' status.
 * Returns the container info. Use `cleanupWorker` in afterEach/afterAll.
 */
export async function createWorker(
  request: APIRequestContext,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; name: string; [key: string]: unknown }> {
  const api = new ApiClient(request);
  const { body: nameData } = await api.generateName();
  const name = nameData.name;

  const { status, body } = await api.createContainer({
    name,
    ...overrides,
  });
  expect(status).toBe(201);
  expect(body.id).toBeTruthy();

  // Wait for running state (workers take time to start)
  await waitForWorkerRunning(request, body.id, 90_000);

  return body;
}

/**
 * Waits for a container to reach 'running' status.
 *
 * Tolerates transient API errors (e.g. 502 Bad Gateway HTML from Traefik
 * during a reconcile, JSON parse errors from a partially-buffered response)
 * — under heavy concurrency in the dockerized runner the orchestrator can
 * occasionally return a malformed body. We just retry the next poll.
 */
export async function waitForWorkerRunning(
  request: APIRequestContext,
  containerId: string,
  timeoutMs = 90_000,
): Promise<void> {
  const api = new ApiClient(request);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const { body: containers } = await api.listContainers();
      const container = containers.find((c: { id: string }) => c.id === containerId);
      if (container && container.status === 'running') return;
      if (container && container.status === 'error') {
        throw new Error(`Container ${containerId} entered error state`);
      }
    } catch (e) {
      // Re-throw real container errors; swallow transient list-API errors
      if (e instanceof Error && e.message.includes('error state')) throw e;
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error(`Container ${containerId} did not reach running state within ${timeoutMs}ms`);
}

/**
 * Stops and removes a worker container. Safe to call if already removed.
 *
 * The remove call retries on transient errors — under contention in the
 * dockerized test runner, the orchestrator can drop a connection mid-call
 * (`socket hang up`). A silent cleanup failure leaves the worker AND its
 * domain mappings around, which then breaks subsequent tests that expect
 * a clean slate.
 */
export async function cleanupWorker(
  request: APIRequestContext,
  containerId: string,
): Promise<void> {
  const api = new ApiClient(request);
  try {
    await api.stopContainer(containerId);
    await new Promise(r => setTimeout(r, 500));
  } catch {
    // Already stopped
  }
  // Retry remove a few times — under heavy concurrency the first attempt
  // can fail with `socket hang up` even though the server processed it.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { status } = await api.removeContainer(containerId);
      if (status >= 200 && status < 300) return;
      if (status === 404) return; // already gone
    } catch {
      // network error — retry
    }
    await new Promise(r => setTimeout(r, 500));
  }
}
