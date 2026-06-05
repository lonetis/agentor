defineRouteMeta({
  openAPI: {
    tags: ['Metrics'],
    summary: 'Get a single worker\'s metrics',
    description:
      'Returns live resource metrics for one worker. Returns a zeroed snapshot (no error) when the worker is not running or has not been sampled yet.',
    operationId: 'getWorkerMetrics',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Worker UUID' }],
    responses: {
      200: {
        description: 'Worker metrics',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/WorkerMetrics' } } },
      },
      401: { description: 'Unauthorized' },
      403: { description: 'Forbidden' },
      404: { description: 'Worker not found' },
    },
  },
});

import { useResourceMonitor, useContainerManager } from '../../../utils/services';
import { requireContainerAccess } from '../../../utils/auth-helpers';
import type { WorkerMetrics } from '../../../../shared/types';

export default defineEventHandler((event): WorkerMetrics => {
  const id = getRouterParam(event, 'id')!;
  const info = useContainerManager().get(id);
  requireContainerAccess(event, info);

  const metric = useResourceMonitor().getWorkerMetric(id);
  if (metric) return metric;

  // Not running / not yet sampled — return a zeroed snapshot the UI can render.
  return {
    workerId: info!.id,
    containerName: info!.containerName,
    displayName: info!.displayName,
    status: info!.status,
    cpuUtilization: 0,
    memoryUsedBytes: 0,
    memoryLimitBytes: 0,
    memoryUtilization: 0,
    diskUsedBytes: 0,
    netRxBytesPerSec: 0,
    netTxBytesPerSec: 0,
    blkReadBytesPerSec: 0,
    blkWriteBytesPerSec: 0,
    lastChecked: new Date().toISOString(),
  };
});
