import type { InitScriptInfo } from '~/types';

export function useInitScripts() {
  const { data: initScripts, refresh } = useFetch<InitScriptInfo[]>('/api/init-scripts', {
    default: () => [],
  });

  async function createInitScript(data: { name: string; content: string }): Promise<InitScriptInfo> {
    const result = await $fetch<InitScriptInfo>('/api/init-scripts', {
      method: 'POST',
      body: data,
    });
    await refresh();
    return result;
  }

  async function updateInitScript(id: string, data: { name?: string; content?: string }): Promise<InitScriptInfo> {
    const result = await $fetch<InitScriptInfo>(`/api/init-scripts/${id}`, {
      method: 'PUT',
      body: data,
    });
    await refresh();
    return result;
  }

  async function deleteInitScript(id: string): Promise<void> {
    await $fetch(`/api/init-scripts/${id}`, { method: 'DELETE' });
    await refresh();
  }

  return {
    initScripts,
    refresh,
    createInitScript,
    updateInitScript,
    deleteInitScript,
  };
}
