import type { ContainerInfo, CreateContainerRequest, UpdateContainerSettingsRequest } from '~/types';
import { createSharedPoller } from '~/composables/usePolling';
import { assignIfChanged } from '~/utils/assign-if-changed';

// Module-level singleton: the dashboard, the import modal and every Apps tab
// read one list kept fresh by a single poll.
const containers = ref<ContainerInfo[]>([]);

let fetchSeq = 0;
let latestFetch: Promise<void> = Promise.resolve();

/** Reload the worker list. Resolves once the newest list has been applied. */
function refresh(): Promise<void> {
  const seq = ++fetchSeq;
  const request = $fetch<ContainerInfo[]>('/api/containers').then(
    (list) => {
      if (seq === fetchSeq) assignIfChanged(containers, list);
    },
    (err) => {
      if (seq === fetchSeq) console.warn('[containers] Failed to load workers:', err);
    },
  );
  latestFetch = request;
  return untilLatestSettled(request);
}

// Overlapping refreshes (a poll racing a mutation) only apply the newest
// response; waiting for it means a caller never reads a list older than its
// own request.
async function untilLatestSettled(request: Promise<void>): Promise<void> {
  let current = request;
  await current;
  while (current !== latestFetch) {
    current = latestFetch;
    await current;
  }
}

const poller = createSharedPoller(refresh, 10_000);

async function createContainer(request: CreateContainerRequest): Promise<ContainerInfo> {
  const result = await $fetch<ContainerInfo>('/api/containers', {
    method: 'POST',
    body: request,
  });
  await refresh();
  return result;
}

async function stopContainer(id: string) {
  await $fetch(`/api/containers/${id}/stop`, { method: 'POST' });
  await refresh();
}

async function restartContainer(id: string) {
  await $fetch(`/api/containers/${id}/restart`, { method: 'POST' });
  await refresh();
}

async function rebuildContainer(id: string): Promise<ContainerInfo> {
  const result = await $fetch<ContainerInfo>(`/api/containers/${id}/rebuild`, { method: 'POST' });
  await refresh();
  return result;
}

async function removeContainer(id: string) {
  await $fetch(`/api/containers/${id}`, { method: 'DELETE' });
  await refresh();
}

async function updateContainerSettings(
  id: string,
  patch: UpdateContainerSettingsRequest,
): Promise<ContainerInfo> {
  const result = await $fetch<ContainerInfo>(`/api/containers/${id}`, {
    method: 'PATCH',
    body: patch,
  });
  await refresh();
  return result;
}

/** Restore a worker from an exported bundle. The bundle is streamed as the raw
 * request body (`application/x-tar`) so multi-GB imports never buffer. */
async function importContainer(file: File, displayName?: string): Promise<ContainerInfo> {
  const query = displayName ? `?displayName=${encodeURIComponent(displayName)}` : '';
  const result = await $fetch<ContainerInfo>(`/api/containers/import${query}`, {
    method: 'POST',
    body: file,
    headers: { 'Content-Type': 'application/x-tar' },
  });
  await refresh();
  return result;
}

export function useContainers() {
  poller.use();

  return {
    containers,
    refresh,
    createContainer,
    stopContainer,
    restartContainer,
    rebuildContainer,
    removeContainer,
    updateContainerSettings,
    importContainer,
  };
}
