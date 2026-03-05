defineRouteMeta({
  openAPI: {
    tags: ['Skills'],
    summary: 'Create skill',
    description: 'Creates a new custom skill.',
    operationId: 'createSkill',
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Skill' } } },
    },
    responses: {
      201: { description: 'Created skill', content: { 'application/json': { schema: { $ref: '#/components/schemas/Skill' } } } },
      400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useSkillStore } from '../../utils/services';

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (!body.name || typeof body.name !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'name is required' });
  }
  if (!body.content || typeof body.content !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'content is required' });
  }

  const store = useSkillStore();
  const skill = await store.create({ name: body.name, content: body.content });
  setResponseStatus(event, 201);
  return skill;
});
