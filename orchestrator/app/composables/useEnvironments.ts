import type { EnvironmentInfo } from '~/types';

export function useEnvironments() {
  const { data: environments, refresh, create, update, remove } = useCrudResource<EnvironmentInfo>('/api/environments');
  return {
    environments,
    refresh,
    createEnvironment: create,
    updateEnvironment: update,
    deleteEnvironment: remove,
  };
}
