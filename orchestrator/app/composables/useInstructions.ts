import type { InstructionInfo } from '~/types';

export function useInstructions() {
  const { data: entries, refresh, create, update, remove } = useCrudResource<InstructionInfo>('/api/instructions');
  return {
    entries,
    refresh,
    createEntry: create,
    updateEntry: update,
    deleteEntry: remove,
  };
}
