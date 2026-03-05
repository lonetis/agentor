defineRouteMeta({
  openAPI: {
    tags: ['Config'],
    summary: 'List init presets',
    description: 'Returns available init script presets for agent startup.',
    operationId: 'listInitPresets',
    responses: {
      200: {
        description: 'Array of init presets',
        content: { 'application/json': { schema: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, script: { type: 'string' }, apiDomains: { type: 'array', items: { type: 'string' } } } } } } },
      },
    },
  },
});

import { listInitPresets } from '../utils/init-presets';

export default defineEventHandler(() => {
  return listInitPresets().map((p) => ({
    id: p.id,
    displayName: p.displayName,
    script: p.script,
    apiDomains: p.apiDomains,
  }));
});
