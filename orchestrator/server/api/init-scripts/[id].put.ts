defineRouteMeta({
  openAPI: {
    tags: ['Init Scripts'],
    summary: 'Update init script',
    description: 'Updates an existing custom init script. Built-in scripts cannot be modified.',
    operationId: 'updateInitScript',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Init script ID' }],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/InitScript' } } },
    },
    responses: {
      200: { description: 'Updated init script', content: { 'application/json': { schema: { $ref: '#/components/schemas/InitScript' } } } },
      400: { description: 'Cannot modify built-in script', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'Init script not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useInitScriptStore } from '../../utils/services';
import { requireAuth, canAccessResource } from '../../utils/auth-helpers';

export default defineEventHandler(async (event) => {
  const ctx = requireAuth(event);
  const id = getRouterParam(event, 'id')!;
  const body = await readBody(event);

  if (body.name !== undefined && (!body.name || typeof body.name !== 'string')) {
    throw createError({ statusCode: 400, statusMessage: 'name must be a non-empty string' });
  }

  const store = useInitScriptStore();

  const existing = store.get(id);
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Init script not found' });
  }
  if (!canAccessResource(ctx, existing, { allowGlobal: false })) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }

  try {
    const updated = await store.update(id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.content !== undefined ? { content: body.content } : {}),
    });
    return updated;
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message.includes('not found')) {
        throw createError({ statusCode: 404, statusMessage: 'Init script not found' });
      }
      if (err.message.includes('built-in')) {
        throw createError({ statusCode: 400, statusMessage: err.message });
      }
    }
    throw err;
  }
});
