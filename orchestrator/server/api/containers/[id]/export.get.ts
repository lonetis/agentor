defineRouteMeta({
  openAPI: {
    tags: ['Containers'],
    summary: 'Export a worker',
    description:
      'Streams a complete worker export bundle (`.tar`) — manifest (settings, environment, port/domain mappings), the workspace and agent-data volumes, and (by default) a `docker export` of the container filesystem. Pass `?includeRootfs=false` to omit the filesystem snapshot (much smaller/faster). The worker must be running or stopped.',
    operationId: 'exportWorker',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Worker UUID' },
      { name: 'includeRootfs', in: 'query', required: false, schema: { type: 'boolean', default: true }, description: 'Include a docker-export snapshot of the container filesystem' },
    ],
    responses: {
      200: { description: 'Worker export bundle (tar stream)', content: { 'application/x-tar': { schema: { type: 'string', format: 'binary' } } } },
      401: { description: 'Unauthorized' },
      403: { description: 'Forbidden' },
      404: { description: 'Worker not found' },
      409: { description: 'Worker not in an exportable state (must be running or stopped)' },
    },
  },
});

import { useContainerManager } from '../../../utils/services';
import { requireContainerAccess } from '../../../utils/auth-helpers';
import { rethrowAsHttpError } from '../../../utils/http-errors';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  const mgr = useContainerManager();
  const info = mgr.get(id);
  requireContainerAccess(event, info);

  const q = getQuery(event);
  // Default to including the full filesystem snapshot (the user-chosen behavior).
  const includeRootfs = q.includeRootfs !== 'false' && q.includeRootfs !== '0';

  // Materialise the bundle before streaming — a bad-state worker throws a 409
  // here (mapped from the manager's statusCode-tagged error) rather than a 500.
  let stream: Awaited<ReturnType<typeof mgr.exportWorker>>['stream'];
  let filename: string;
  try {
    ({ stream, filename } = await mgr.exportWorker(id, { includeRootfs }));
  } catch (err) {
    rethrowAsHttpError(err);
  }

  // If the client disconnects before the bundle is fully sent, destroy the
  // stream so its 'close' handler fires and the temp dir is cleaned up.
  event.node.res.on('close', () => {
    if (!event.node.res.writableEnded) stream.destroy();
  });

  setResponseHeaders(event, {
    'Content-Type': 'application/x-tar',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Transfer-Encoding': 'chunked',
  });
  return sendStream(event, stream);
});
