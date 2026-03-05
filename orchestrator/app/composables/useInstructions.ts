import type { InstructionInfo } from '~/types';

export function useInstructions() {
  const { data: instructions, refresh } = useFetch<InstructionInfo[]>('/api/instructions', {
    default: () => [],
  });

  async function createInstruction(data: { name: string; content: string }): Promise<InstructionInfo> {
    const result = await $fetch<InstructionInfo>('/api/instructions', {
      method: 'POST',
      body: data,
    });
    await refresh();
    return result;
  }

  async function updateInstruction(id: string, data: { name?: string; content?: string }): Promise<InstructionInfo> {
    const result = await $fetch<InstructionInfo>(`/api/instructions/${id}`, {
      method: 'PUT',
      body: data,
    });
    await refresh();
    return result;
  }

  async function deleteInstruction(id: string): Promise<void> {
    await $fetch(`/api/instructions/${id}`, { method: 'DELETE' });
    await refresh();
  }

  return {
    instructions,
    refresh,
    createInstruction,
    updateInstruction,
    deleteInstruction,
  };
}
