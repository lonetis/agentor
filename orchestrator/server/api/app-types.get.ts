defineRouteMeta({
  openAPI: {
    tags: ['Config'],
    summary: 'List app types',
    description: 'Returns available app types that can run inside workers.',
    operationId: 'listAppTypes',
    responses: {
      200: {
        description: 'Array of app types',
        content: {
          'application/json': {
            schema: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  displayName: { type: 'string' },
                  description: { type: 'string' },
                  ports: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } } },
                  maxInstances: { type: 'integer' },
                  singleton: { type: 'boolean' },
                  fixedInternalPort: { type: 'integer', description: 'Present only for apps with a fixed internal port (e.g. ssh → 22)' },
                  autoPortMapping: { type: 'object', nullable: true, properties: { type: { type: 'string', enum: ['external', 'localhost'] }, externalPortStart: { type: 'integer' }, externalPortEnd: { type: 'integer' } } },
                },
              },
            },
          },
        },
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
    singleton: t.singleton ?? false,
    ...(t.fixedInternalPort !== undefined ? { fixedInternalPort: t.fixedInternalPort } : {}),
    ...(t.autoPortMapping ? { autoPortMapping: t.autoPortMapping } : {}),
  }));
});
