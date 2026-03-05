defineRouteMeta({
  openAPI: {
    tags: ['Config'],
    summary: 'List app types',
    description: 'Returns available app types that can run inside workers.',
    operationId: 'listAppTypes',
    responses: {
      200: {
        description: 'Array of app types',
        content: { 'application/json': { schema: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, defaultPort: { type: 'integer' } } } } } },
      },
    },
  },
});

import { listAppTypes } from '../utils/apps';

export default defineEventHandler(() => {
  return listAppTypes().map((t) => ({
    id: t.id,
    displayName: t.displayName,
    description: t.description,
    ports: t.ports.map((p) => ({ id: p.id, name: p.name })),
    maxInstances: t.maxInstances,
  }));
});
