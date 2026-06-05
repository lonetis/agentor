defineRouteMeta({
  openAPI: {
    tags: ['Metrics'],
    summary: 'Refresh per-worker metrics',
    description: 'Forces an immediate re-sample of per-worker cpu/mem/net and disk, bypassing the poll interval. Returns the caller-owned workers (admins see all).',
    operationId: 'refreshWorkerMetrics',
    responses: {
      200: {
        description: 'Per-worker metrics',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/WorkerMetricsStatus' } } },
      },
      401: { description: 'Unauthorized' },
    },
  },
});

import { useResourceMonitor, useContainerManager } from '../../utils/services';
import { requireAuth } from '../../utils/auth-helpers';

export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event);
  const monitor = useResourceMonitor();
  await monitor.refresh();
  const all = monitor.getWorkerMetricsStatus().workers;
  if (user.role === 'admin') return { workers: all };
  const mgr = useContainerManager();
  return { workers: all.filter((m) => mgr.get(m.workerId)?.userId === user.id) };
});
