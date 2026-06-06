import type { ArchivedWorker } from '~/types';

export function useArchivedWorkers() {
  const { data: archivedWorkers, refresh } = useFetch<ArchivedWorker[]>('/api/archived', {
    default: () => [],
  });

  usePolling(() => refresh(), 10_000);

  async function archiveWorker(id: string) {
    await $fetch(`/api/containers/${id}/archive`, { method: 'POST' });
    await refresh();
  }

  async function unarchiveWorker(id: string) {
    await $fetch(`/api/archived/${id}/unarchive`, { method: 'POST' });
    await refresh();
  }

  async function deleteArchivedWorker(id: string) {
    await $fetch(`/api/archived/${id}`, { method: 'DELETE' });
    await refresh();
  }

  return {
    archivedWorkers,
    refresh,
    archiveWorker,
    unarchiveWorker,
    deleteArchivedWorker,
  };
}
