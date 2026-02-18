import type { ContainerInfo, CreateContainerRequest } from '~/types';

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

  async function removeContainer(id: string) {
    await $fetch(`/api/containers/${id}`, { method: 'DELETE' });
    await refresh();
  }

  return {
    containers,
    refresh,
    createContainer,
    stopContainer,
    restartContainer,
    removeContainer,
  };
}
