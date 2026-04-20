defineRouteMeta({
  openAPI: {
    tags: ['Init Scripts'],
    summary: 'Get init script',
    description: 'Returns a single init script by ID.',
    operationId: 'getInitScript',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Init script ID' }],
    responses: {
      200: { description: 'Init script details', content: { 'application/json': { schema: { $ref: '#/components/schemas/InitScript' } } } },
      404: { description: 'Init script not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useInitScriptStore } from '../../utils/services';
import { requireAuth, canAccessResource } from '../../utils/auth-helpers';

export default defineEventHandler((event) => {
  const ctx = requireAuth(event);
  const id = getRouterParam(event, 'id')!;
  const script = useInitScriptStore().getById(id);

  if (!script) {
    throw createError({ statusCode: 404, statusMessage: 'Init script not found' });
  }
  if (!canAccessResource(ctx, script)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }

  return script;
});
