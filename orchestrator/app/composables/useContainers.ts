import type { ContainerInfo, CreateContainerRequest, UpdateContainerSettingsRequest } from '~/types';

export function useContainers() {
  const { data: containers, refresh } = useFetch<ContainerInfo[]>('/api/containers', {
    default: () => [],
  });

  usePolling(() => refresh(), 10_000);

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

  async function renameContainer(id: string, displayName: string): Promise<ContainerInfo> {
    return updateContainerSettings(id, { displayName });
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

  return {
    containers,
    refresh,
    createContainer,
    stopContainer,
    restartContainer,
    rebuildContainer,
    removeContainer,
    renameContainer,
    updateContainerSettings,
    importContainer,
  };
}
