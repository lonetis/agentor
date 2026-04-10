import { APIRequestContext, expect } from '@playwright/test';
import { ApiClient } from './api-client';

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

/**
 * Removes all test containers. Useful for cleanup.
 */
export async function cleanupAllWorkers(request: APIRequestContext): Promise<void> {
  const api = new ApiClient(request);
  const { body: containers } = await api.listContainers();
  for (const c of containers) {
    await cleanupWorker(request, c.id);
  }
  // Also clean up archived workers
  const { body: archived } = await api.listArchived();
  for (const w of archived) {
    try {
      await api.deleteArchivedWorker(w.name);
    } catch { /* ignore */ }
  }
}

/**
 * Cleans up all port mappings.
 */
export async function cleanupAllPortMappings(request: APIRequestContext): Promise<void> {
  const api = new ApiClient(request);
  const { body: mappings } = await api.listPortMappings();
  for (const m of mappings) {
    try {
      await api.deletePortMapping(m.externalPort);
    } catch { /* ignore */ }
  }
}

/**
 * Cleans up all domain mappings.
 */
export async function cleanupAllDomainMappings(request: APIRequestContext): Promise<void> {
  const api = new ApiClient(request);
  const { body: mappings } = await api.listDomainMappings();
  for (const m of mappings) {
    try {
      await api.deleteDomainMapping(m.id);
    } catch { /* ignore */ }
  }
}

/**
 * Cleans up all environments.
 */
export async function cleanupAllEnvironments(request: APIRequestContext): Promise<void> {
  const api = new ApiClient(request);
  const { body: environments } = await api.listEnvironments();
  for (const e of environments) {
    try {
      await api.deleteEnvironment(e.id);
    } catch { /* ignore */ }
  }
}

/**
 * Cleans up all custom capabilities (built-in capabilities cannot be deleted).
 */
export async function cleanupAllCustomCapabilities(request: APIRequestContext): Promise<void> {
  const api = new ApiClient(request);
  const { body: capabilities } = await api.listCapabilities();
  for (const s of capabilities) {
    if (!s.builtIn) {
      try { await api.deleteCapability(s.id); } catch { /* ignore */ }
    }
  }
}

/**
 * Cleans up all custom instructions (built-in instructions cannot be deleted).
 */
export async function cleanupAllCustomInstructions(request: APIRequestContext): Promise<void> {
  const api = new ApiClient(request);
  const { body: entries } = await api.listInstructions();
  for (const e of entries) {
    if (!e.builtIn) {
      try { await api.deleteInstruction(e.id); } catch { /* ignore */ }
    }
  }
}

/**
 * Cleans up all custom init scripts (built-in scripts cannot be deleted).
 */
export async function cleanupAllCustomInitScripts(request: APIRequestContext): Promise<void> {
  const api = new ApiClient(request);
  const { body: scripts } = await api.listInitScripts();
  for (const s of scripts) {
    if (!s.builtIn) {
      try { await api.deleteInitScript(s.id); } catch { /* ignore */ }
    }
  }
}
