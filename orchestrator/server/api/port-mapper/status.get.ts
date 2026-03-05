defineRouteMeta({
  openAPI: {
    tags: ['Port Mappings'],
    summary: 'Get port mapper status',
    description: 'Returns mapping counts by type (localhost/external).',
    operationId: 'getPortMapperStatus',
    responses: {
      200: {
        description: 'Mapper status',
        content: { 'application/json': { schema: { type: 'object', properties: { localhost: { type: 'integer' }, external: { type: 'integer' }, total: { type: 'integer' } } } } },
      },
    },
  },
});

import { usePortMappingStore } from '../../utils/services';

export default defineEventHandler(() => {
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
