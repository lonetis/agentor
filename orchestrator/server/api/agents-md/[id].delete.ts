defineRouteMeta({
  openAPI: {
    tags: ['AGENTS.md'],
    summary: 'Delete AGENTS.md entry',
    description: 'Deletes a custom AGENTS.md entry. Built-in entries cannot be deleted.',
    operationId: 'deleteAgentsMdEntry',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'AGENTS.md entry ID' }],
    responses: {
      200: { description: 'AGENTS.md entry deleted', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
      400: { description: 'Cannot delete built-in entry', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'AGENTS.md entry not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useAgentsMdStore } from '../../utils/services';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  const store = useAgentsMdStore();

  try {
    await store.delete(id);
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message.includes('not found')) {
        throw createError({ statusCode: 404, statusMessage: 'AGENTS.md entry not found' });
      }
      if (err.message.includes('built-in')) {
        throw createError({ statusCode: 400, statusMessage: err.message });
      }
    }
    throw err;
  }

  return { ok: true };
});
