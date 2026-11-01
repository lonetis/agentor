import type { WorkerMetrics, WorkerMetricsStatus } from '~/types';
import { createSharedPoller } from '~/composables/usePolling';
import { assignIfChanged } from '~/utils/assign-if-changed';

// Module-level singleton: every ContainerCard reads from one poll.
const workers = ref<WorkerMetrics[]>([]);

async function fetchWorkerMetrics() {
  try {
    const status = await $fetch<WorkerMetricsStatus>('/api/worker-metrics');
    assignIfChanged(workers, status.workers);
  } catch (err) {
    // Keep the last good sample on a transient failure.
    console.warn('[worker-metrics] Failed to load worker metrics:', err);
  }
}

const poller = createSharedPoller(fetchWorkerMetrics, 10_000);

export function useWorkerMetrics() {
  poller.use();
  return { workers, refresh: poller.trigger };
}
