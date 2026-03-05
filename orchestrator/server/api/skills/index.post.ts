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

  if (!body.content || typeof body.content !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'content is required' });
  }

  const store = useSkillStore();

  try {
    const skill = await store.create({ content: body.content });
    setResponseStatus(event, 201);
    return skill;
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('frontmatter')) {
      throw createError({ statusCode: 400, statusMessage: err.message });
    }
    throw err;
  }
});
