defineRouteMeta({
  openAPI: {
    tags: ['Worker Self'],
    summary: 'Port mapper status (worker-self view)',
    description: 'Returns total port mapping counts. Caller is identified by source IP.',
    operationId: 'workerSelfPortMapperStatus',
    responses: {
      200: { description: 'Port mapper status' },
      401: { description: 'Caller IP did not resolve to a managed worker' },
    },
  },
});

import { usePortMappingStore } from '../../../utils/services';
import { requireWorkerSelf } from '../../../utils/worker-auth';

export default defineEventHandler(async (event) => {
  await requireWorkerSelf(event);

  const mappings = usePortMappingStore().list();
  let localhostCount = 0;
  let externalCount = 0;
  for (const m of mappings) {
    if (m.type === 'localhost') localhostCount++;
    else externalCount++;
  }
  return {
    totalMappings: mappings.length,
    localhostCount,
    externalCount,
  };
});
