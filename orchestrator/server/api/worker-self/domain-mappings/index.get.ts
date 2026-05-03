defineRouteMeta({
  openAPI: {
    tags: ['Worker Self'],
    summary: 'List the calling worker\'s domain mappings',
    description: 'Returns domain mappings owned by the worker container that issued the request. Caller is identified by source IP.',
    operationId: 'workerSelfListDomainMappings',
    responses: {
      200: {
        description: 'Array of domain mappings owned by the calling worker',
        content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/DomainMapping' } } } },
      },
      401: { description: 'Caller IP did not resolve to a managed worker' },
    },
  },
});

import { useDomainMappingStore } from '../../../utils/services';
import { requireWorkerSelf } from '../../../utils/worker-auth';

export default defineEventHandler(async (event) => {
  const ctx = await requireWorkerSelf(event);
  return useDomainMappingStore().list().filter((m) => m.containerName === ctx.containerName);
});
