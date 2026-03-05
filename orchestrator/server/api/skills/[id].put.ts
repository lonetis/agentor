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

  if (!body.content || typeof body.content !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'content is required' });
  }

  const store = useSkillStore();

  try {
    return await store.update(id, { content: body.content });
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message.includes('not found')) {
        throw createError({ statusCode: 404, statusMessage: 'Skill not found' });
      }
      if (err.message.includes('built-in') || err.message.includes('frontmatter')) {
        throw createError({ statusCode: 400, statusMessage: err.message });
      }
    }
    throw err;
  }
});
