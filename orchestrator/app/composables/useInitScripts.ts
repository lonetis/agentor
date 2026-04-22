import type { InitScriptInfo } from '~/types';

export function useInitScripts() {
  const { data: initScripts, refresh, create, update, remove } = useCrudResource<InitScriptInfo>('/api/init-scripts');
  return {
    initScripts,
    refresh,
    createInitScript: create,
    updateInitScript: update,
    deleteInitScript: remove,
  };
}
