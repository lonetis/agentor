import type { AgentsMdEntryInfo } from '~/types';

export function useAgentsMd() {
  const { data: entries, refresh } = useFetch<AgentsMdEntryInfo[]>('/api/agents-md', {
    default: () => [],
  });

  async function createEntry(data: { name: string; content: string }): Promise<AgentsMdEntryInfo> {
    const result = await $fetch<AgentsMdEntryInfo>('/api/agents-md', {
      method: 'POST',
      body: data,
    });
    await refresh();
    return result;
  }

  async function updateEntry(id: string, data: { name?: string; content?: string }): Promise<AgentsMdEntryInfo> {
    const result = await $fetch<AgentsMdEntryInfo>(`/api/agents-md/${id}`, {
      method: 'PUT',
      body: data,
    });
    await refresh();
    return result;
  }

  async function deleteEntry(id: string): Promise<void> {
    await $fetch(`/api/agents-md/${id}`, { method: 'DELETE' });
    await refresh();
  }

  return {
    entries,
    refresh,
    createEntry,
    updateEntry,
    deleteEntry,
  };
}
