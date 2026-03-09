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
 */
export async function waitForWorkerRunning(
  request: APIRequestContext,
  containerId: string,
  timeoutMs = 90_000,
): Promise<void> {
  const api = new ApiClient(request);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { body: containers } = await api.listContainers();
    const container = containers.find((c: { id: string }) => c.id === containerId);
    if (container && container.status === 'running') return;
    if (container && container.status === 'error') {
      throw new Error(`Container ${containerId} entered error state`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error(`Container ${containerId} did not reach running state within ${timeoutMs}ms`);
}

/**
 * Stops and removes a worker container. Safe to call if already removed.
 */
export async function cleanupWorker(
  request: APIRequestContext,
  containerId: string,
): Promise<void> {
  const api = new ApiClient(request);
  try {
    // Try to stop first
    await api.stopContainer(containerId);
    // Wait a bit for stop to complete
    await new Promise(r => setTimeout(r, 1000));
  } catch {
    // Ignore errors — might already be stopped
  }
  try {
    await api.removeContainer(containerId);
  } catch {
    // Ignore — might already be removed
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
 * Cleans up all custom skills (built-in skills cannot be deleted).
 */
export async function cleanupAllCustomSkills(request: APIRequestContext): Promise<void> {
  const api = new ApiClient(request);
  const { body: skills } = await api.listSkills();
  for (const s of skills) {
    if (!s.builtIn) {
      try { await api.deleteSkill(s.id); } catch { /* ignore */ }
    }
  }
}

/**
 * Cleans up all custom AGENTS.md entries (built-in entries cannot be deleted).
 */
export async function cleanupAllCustomAgentsMd(request: APIRequestContext): Promise<void> {
  const api = new ApiClient(request);
  const { body: entries } = await api.listAgentsMd();
  for (const e of entries) {
    if (!e.builtIn) {
      try { await api.deleteAgentsMd(e.id); } catch { /* ignore */ }
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
