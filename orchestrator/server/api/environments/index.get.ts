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
              cpuLimit: { type: 'number', description: '0 = unrestricted' },
              memoryLimit: { type: 'string', description: 'e.g. 4g, 512m' },
              networkMode: { type: 'string', enum: ['full', 'block', 'block-all', 'package-managers', 'custom'] },
              allowedDomains: { type: 'array', items: { type: 'string' } },
              includePackageManagerDomains: { type: 'boolean' },
              dockerEnabled: { type: 'boolean' },
              envVars: { type: 'string', description: 'Custom env vars as KEY=VALUE lines' },
              setupScript: { type: 'string' },
              exposeApis: {
                type: 'object',
                properties: {
                  portMappings: { type: 'boolean' },
                  domainMappings: { type: 'boolean' },
                  usage: { type: 'boolean' },
                },
              },
              enabledCapabilityIds: { type: 'array', items: { type: 'string' }, nullable: true, description: 'null = all enabled' },
              enabledInstructionIds: { type: 'array', items: { type: 'string' }, nullable: true, description: 'null = all enabled' },
              builtIn: { type: 'boolean' },
              userId: { type: 'string', nullable: true, description: 'null for built-in/global environments' },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
  },
});

import { useEnvironmentStore } from '../../utils/services';
import { requireAuth } from '../../utils/auth-helpers';

export default defineEventHandler((event) => {
  const { user } = requireAuth(event);
  const all = useEnvironmentStore().list();
  if (user.role === 'admin') return all;
  return all.filter((e) => e.userId === null || e.userId === user.id);
});
