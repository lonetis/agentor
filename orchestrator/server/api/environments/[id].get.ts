defineRouteMeta({
  openAPI: {
    tags: ['Environments'],
    summary: 'Get environment',
    description: 'Returns a single environment by ID.',
    operationId: 'getEnvironment',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Environment ID' }],
    responses: {
      200: { description: 'Environment details', content: { 'application/json': { schema: { $ref: '#/components/schemas/Environment' } } } },
      404: { description: 'Environment not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useEnvironmentStore } from '../../utils/services';
import { requireAuth, canAccessResource } from '../../utils/auth-helpers';

export default defineEventHandler((event) => {
  const ctx = requireAuth(event);
  const id = getRouterParam(event, 'id')!;
  const env = useEnvironmentStore().get(id);

  if (!env) {
    throw createError({ statusCode: 404, statusMessage: 'Environment not found' });
  }
  if (!canAccessResource(ctx, env)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }

  return env;
});
