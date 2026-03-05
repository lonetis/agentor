defineRouteMeta({
  openAPI: {
    tags: ['Environments'],
    summary: 'List environments',
    description: 'Returns all worker environment configurations.',
    operationId: 'listEnvironments',
    responses: {
      200: {
        description: 'Array of environments',
        content: {
          'application/json': {
            schema: {
              type: 'array',
              items: { $ref: '#/components/schemas/Environment' },
            },
          },
        },
      },
    },
    $global: {
      components: {
        schemas: {
          Environment: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              cpuLimit: { type: 'number' },
              memoryLimit: { type: 'string' },
              networkMode: { type: 'string', enum: ['full', 'block', 'block-all', 'package-managers', 'custom'] },
              customDomains: { type: 'array', items: { type: 'string' } },
              includePackageManagers: { type: 'boolean' },
              dockerEnabled: { type: 'boolean' },
              envVars: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'string' } } } },
              setupScript: { type: 'string' },
            },
          },
        },
      },
    },
  },
});

import { useEnvironmentStore } from '../../utils/services';

export default defineEventHandler(() => {
  return useEnvironmentStore().list();
});
