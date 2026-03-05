defineRouteMeta({
  openAPI: {
    tags: ['Skills'],
    summary: 'Delete skill',
    description: 'Deletes a custom skill. Built-in skills cannot be deleted.',
    operationId: 'deleteSkill',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Skill ID' }],
    responses: {
      200: { description: 'Skill deleted', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
      400: { description: 'Cannot delete built-in skill', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'Skill not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useSkillStore } from '../../utils/services';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  const store = useSkillStore();

  try {
    await store.delete(id);
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message.includes('not found')) {
        throw createError({ statusCode: 404, statusMessage: 'Skill not found' });
      }
      if (err.message.includes('built-in')) {
        throw createError({ statusCode: 400, statusMessage: err.message });
      }
    }
    throw err;
  }

  return { ok: true };
});
