defineRouteMeta({
  openAPI: {
    tags: ['Worker Self'],
    summary: 'List the calling worker\'s port mappings',
    description: 'Returns port mappings owned by the worker container that issued the request. Caller is identified by source IP on the agentor-net Docker network — no session cookie required.',
    operationId: 'workerSelfListPortMappings',
    responses: {
      200: {
        description: 'Array of port mappings owned by the calling worker',
        content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/PortMapping' } } } },
      },
      401: { description: 'Caller IP did not resolve to a managed worker' },
    },
  },
});

import { usePortMappingStore } from '../../../utils/services';
import { requireWorkerSelf } from '../../../utils/worker-auth';

export default defineEventHandler(async (event) => {
  const ctx = await requireWorkerSelf(event);
  return usePortMappingStore().list().filter((m) => m.containerName === ctx.containerName);
});
