defineRouteMeta({
  openAPI: {
    tags: ['Init Scripts'],
    summary: 'List init scripts',
    description: 'Returns all init scripts (built-in and custom).',
    operationId: 'listInitScripts',
    responses: {
      200: {
        description: 'Array of init scripts',
        content: {
          'application/json': {
            schema: {
              type: 'array',
              items: { $ref: '#/components/schemas/InitScript' },
            },
          },
        },
      },
    },
    $global: {
      components: {
        schemas: {
          InitScript: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              content: { type: 'string' },
              builtIn: { type: 'boolean' },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
  },
});

import { useInitScriptStore } from '../../utils/services';
import type { InitScriptInfo } from '../../../shared/types';

export default defineEventHandler((): InitScriptInfo[] => {
  return useInitScriptStore().list();
});
