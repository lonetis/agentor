defineRouteMeta({
  openAPI: {
    tags: ['Skills'],
    summary: 'Update skill',
    description: 'Updates an existing custom skill. Built-in skills cannot be modified.',
    operationId: 'updateSkill',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Skill ID' }],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Skill' } } },
    },
    responses: {
      200: { description: 'Updated skill', content: { 'application/json': { schema: { $ref: '#/components/schemas/Skill' } } } },
      400: { description: 'Cannot modify built-in skill', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'Skill not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useSkillStore } from '../../utils/services';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  const body = await readBody(event);

  const update: { name?: string; content?: string } = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name) {
      throw createError({ statusCode: 400, statusMessage: 'name must be a non-empty string' });
    }
    update.name = body.name;
  }
  if (body.content !== undefined) {
    if (typeof body.content !== 'string' || !body.content) {
      throw createError({ statusCode: 400, statusMessage: 'content must be a non-empty string' });
    }
    update.content = body.content;
  }

  const store = useSkillStore();

  try {
    return await store.update(id, update);
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
});
