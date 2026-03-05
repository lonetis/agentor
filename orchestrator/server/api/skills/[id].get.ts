defineRouteMeta({
  openAPI: {
    tags: ['Skills'],
    summary: 'Get skill',
    description: 'Returns a single skill by ID.',
    operationId: 'getSkill',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Skill ID' }],
    responses: {
      200: { description: 'Skill details', content: { 'application/json': { schema: { $ref: '#/components/schemas/Skill' } } } },
      404: { description: 'Skill not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useSkillStore } from '../../utils/services';

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')!;
  const skill = useSkillStore().get(id);

  if (!skill) {
    throw createError({ statusCode: 404, statusMessage: 'Skill not found' });
  }

  return skill;
});
