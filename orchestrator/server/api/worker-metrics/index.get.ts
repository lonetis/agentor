defineRouteMeta({
  openAPI: {
    tags: ['Metrics'],
    summary: 'List per-worker metrics',
    description:
      'Returns live per-worker resource metrics for every running worker the caller owns (admins see all). Workers that are not running are omitted.',
    operationId: 'listWorkerMetrics',
    responses: {
      200: {
        description: 'Per-worker metrics',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/WorkerMetricsStatus' } } },
      },
      401: { description: 'Unauthorized' },
    },
    $global: {
      components: {
        schemas: {
          WorkerMetrics: {
            type: 'object',
            properties: {
              workerId: { type: 'string' },
              containerName: { type: 'string' },
              displayName: { type: 'string' },
              status: { type: 'string' },
              cpuUtilization: { type: 'number', description: '0-100 of total host CPU' },
              memoryUsedBytes: { type: 'number' },
              memoryLimitBytes: { type: 'number' },
              memoryUtilization: { type: 'number' },
              diskUsedBytes: { type: 'number', description: 'Writable layer (SizeRw) + /workspace + agent data' },
              netRxBytesPerSec: { type: 'number' },
              netTxBytesPerSec: { type: 'number' },
              blkReadBytesPerSec: { type: 'number' },
              blkWriteBytesPerSec: { type: 'number' },
              lastChecked: { type: 'string', format: 'date-time' },
              error: { type: 'string' },
            },
          },
          WorkerMetricsStatus: {
            type: 'object',
            properties: {
              workers: { type: 'array', items: { $ref: '#/components/schemas/WorkerMetrics' } },
            },
          },
        },
      },
    },
  },
});

import { useResourceMonitor, useContainerManager } from '../../utils/services';
import { requireAuth } from '../../utils/auth-helpers';

export default defineEventHandler((event) => {
  const { user } = requireAuth(event);
  const all = useResourceMonitor().getWorkerMetricsStatus().workers;
  if (user.role === 'admin') return { workers: all };
  const mgr = useContainerManager();
  const workers = all.filter((m) => mgr.get(m.workerId)?.userId === user.id);
  return { workers };
});
