defineRouteMeta({
  openAPI: {
    tags: ['Instructions'],
    summary: 'List instructions',
    description: 'Returns all instructions (built-in and custom).',
    operationId: 'listInstructions',
    responses: {
      200: {
        description: 'Array of instructions',
        content: {
          'application/json': {
            schema: {
              type: 'array',
              items: { $ref: '#/components/schemas/Instruction' },
            },
          },
        },
      },
    },
    $global: {
      components: {
        schemas: {
          Instruction: {
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

import { useInstructionStore } from '../../utils/services';

export default defineEventHandler(() => {
  return useInstructionStore().list();
});
