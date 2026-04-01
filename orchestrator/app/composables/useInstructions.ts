import type { InstructionInfo } from '~/types';

export function useInstructions() {
  const { data: entries, refresh } = useFetch<InstructionInfo[]>('/api/instructions', {
    default: () => [],
  });

  async function createEntry(data: { name: string; content: string }): Promise<InstructionInfo> {
    const result = await $fetch<InstructionInfo>('/api/instructions', {
      method: 'POST',
      body: data,
    });
    await refresh();
    return result;
  }

  async function updateEntry(id: string, data: { name?: string; content?: string }): Promise<InstructionInfo> {
    const result = await $fetch<InstructionInfo>(`/api/instructions/${id}`, {
      method: 'PUT',
      body: data,
    });
    await refresh();
    return result;
  }

  async function deleteEntry(id: string): Promise<void> {
    await $fetch(`/api/instructions/${id}`, { method: 'DELETE' });
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
