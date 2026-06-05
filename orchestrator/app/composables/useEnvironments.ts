import type { EnvironmentInfo } from '~/types';

export function useEnvironments() {
  const { data: environments, refresh, create, update, remove } = useCrudResource<EnvironmentInfo>('/api/environments');

  // Id of the built-in `default` environment — used to pre-select the default
  // in worker forms. Built-in ids are derived UUIDs (not the slug), so resolve
  // it from the loaded list by the `builtIn` flag + `default` name instead of
  // hardcoding a literal id.
  const defaultEnvironmentId = computed(() => {
    const envs = environments.value ?? [];
    return envs.find((e) => e.builtIn && e.name === 'default')?.id
      ?? envs.find((e) => e.builtIn)?.id
      ?? envs[0]?.id
      ?? '';
  });

  return {
    environments,
    defaultEnvironmentId,
    refresh,
    createEnvironment: create,
    updateEnvironment: update,
    deleteEnvironment: remove,
  };
}
