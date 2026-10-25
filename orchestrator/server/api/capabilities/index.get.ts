defineRouteMeta({
  openAPI: {
    tags: ['Capabilities'],
    summary: 'List capabilities',
    description: 'Returns all capabilities (built-in and custom).',
    operationId: 'listCapabilities',
    responses: {
      200: {
        description: 'Array of capabilities',
        content: {
          'application/json': {
            schema: {
              type: 'array',
              items: { $ref: '#/components/schemas/Capability' },
            },
          },
        },
      },
    },
    $global: {
      components: {
        schemas: {
          CapabilityInput: {
            type: 'object',
            description: 'Skill document installed into the agent CLIs (Claude, Codex, Antigravity) of workers whose environment enables it. Agent Skills format: markdown with YAML frontmatter (`name`, `description`, optional `license`, `compatibility`, `metadata`, `allowed-tools`).',
            properties: {
              name: { type: 'string', description: "Unique capability name (also the installed skill's directory name)" },
              content: { type: 'string', description: 'Skill markdown including the YAML frontmatter' },
            },
          },
          Capability: {
            type: 'object',
            allOf: [
              { $ref: '#/components/schemas/CapabilityInput' },
              {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  builtIn: { type: 'boolean', description: 'Platform-provided; read-only' },
                  userId: { type: 'string', nullable: true, description: 'Owner (null for built-ins)' },
                  createdAt: { type: 'string', format: 'date-time' },
                  updatedAt: { type: 'string', format: 'date-time' },
                },
              },
            ],
          },
        },
      },
    },
  },
});

import { useCapabilityStore } from '../../utils/services';
import { requireAuth } from '../../utils/auth-helpers';

export default defineEventHandler((event) => {
  const { user } = requireAuth(event);
  const all = useCapabilityStore().list();
  if (user.role === 'admin') return all;
  return all.filter((c) => c.userId === null || c.userId === user.id);
});
