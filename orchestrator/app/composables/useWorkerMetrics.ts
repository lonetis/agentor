import type { WorkerMetrics, WorkerMetricsStatus } from '~/types';

// Module-level singleton — every ContainerCard reads from one poll.
const workers = ref<WorkerMetrics[]>([]);
let initialized = false;

async function fetchWorkerMetrics() {
  try {
    const status = await $fetch<WorkerMetricsStatus>('/api/worker-metrics');
    workers.value = status.workers;
  } catch {
    // Keep the last good sample on a transient failure.
  }
}

export function useWorkerMetrics() {
  if (!initialized) {
    initialized = true;
    fetchWorkerMetrics();
  }
  usePolling(() => fetchWorkerMetrics(), 10_000);
  return { workers, refresh: fetchWorkerMetrics };
}
