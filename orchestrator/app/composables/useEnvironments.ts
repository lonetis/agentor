import type { EnvironmentInfo } from '~/types';

export function useEnvironments() {
  const { data: environments, refresh } = useFetch<EnvironmentInfo[]>('/api/environments', {
    default: () => [],
  });

  async function createEnvironment(data: Partial<EnvironmentInfo>): Promise<EnvironmentInfo> {
    const result = await $fetch<EnvironmentInfo>('/api/environments', {
      method: 'POST',
      body: data,
    });
    await refresh();
    return result;
  }

  async function updateEnvironment(id: string, data: Partial<EnvironmentInfo>): Promise<EnvironmentInfo> {
    const result = await $fetch<EnvironmentInfo>(`/api/environments/${id}`, {
      method: 'PUT',
      body: data,
    });
    await refresh();
    return result;
  }

  async function deleteEnvironment(id: string): Promise<void> {
    await $fetch(`/api/environments/${id}`, { method: 'DELETE' });
    await refresh();
  }

  return {
    environments,
    refresh,
    createEnvironment,
    updateEnvironment,
    deleteEnvironment,
  };
}
