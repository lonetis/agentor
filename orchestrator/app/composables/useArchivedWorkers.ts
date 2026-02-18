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

  async function unarchiveWorker(name: string) {
    await $fetch(`/api/archived/${name}/unarchive`, { method: 'POST' });
    await refresh();
  }

  async function deleteArchivedWorker(name: string) {
    await $fetch(`/api/archived/${name}`, { method: 'DELETE' });
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
