defineRouteMeta({
  openAPI: {
    tags: ['Skills'],
    summary: 'List skills',
    description: 'Returns all skills (built-in and custom).',
    operationId: 'listSkills',
    responses: {
      200: {
        description: 'Array of skills',
        content: {
          'application/json': {
            schema: {
              type: 'array',
              items: { $ref: '#/components/schemas/Skill' },
            },
          },
        },
      },
    },
    $global: {
      components: {
        schemas: {
          Skill: {
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

import { useSkillStore } from '../../utils/services';

export default defineEventHandler(() => {
  return useSkillStore().list();
});
