defineRouteMeta({
  openAPI: {
    tags: ['Port Mappings'],
    summary: 'Get port mapper status',
    description: 'Returns mapping counts by type (localhost/external).',
    operationId: 'getPortMapperStatus',
    responses: {
      200: {
        description: 'Mapper status',
        content: { 'application/json': { schema: { type: 'object', properties: { totalMappings: { type: 'integer' }, localhostCount: { type: 'integer' }, externalCount: { type: 'integer' } } } } },
      },
    },
  },
});

import { usePortMappingStore } from '../../utils/services';
import { requireAuth } from '../../utils/auth-helpers';

export default defineEventHandler((event) => {
  const { user } = requireAuth(event);
  const all = usePortMappingStore().list();
  // Scope counts to the caller (admins keep the global totals) so a regular user
  // can't probe how many mappings exist across the whole deployment.
  const mappings = user.role === 'admin' ? all : all.filter((m) => m.userId === user.id);
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
