defineRouteMeta({
  openAPI: {
    tags: ['Init Scripts'],
    summary: 'Create init script',
    description: 'Creates a new custom init script.',
    operationId: 'createInitScript',
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/InitScript' } } },
    },
    responses: {
      201: { description: 'Created init script', content: { 'application/json': { schema: { $ref: '#/components/schemas/InitScript' } } } },
      400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useInitScriptStore } from '../../utils/services';
import { requireAuth } from '../../utils/auth-helpers';

export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event);
  const body = await readBody(event);

  if (!body.name || typeof body.name !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'name is required' });
  }
  if (!body.content || typeof body.content !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'content is required' });
  }

  const store = useInitScriptStore();
  const script = await store.create({ name: body.name, content: body.content, userId: user.id });

  setResponseStatus(event, 201);
  return script;
});
