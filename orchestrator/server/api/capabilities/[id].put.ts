defineRouteMeta({
  openAPI: {
    tags: ['Capabilities'],
    summary: 'Update capability',
    description: 'Updates an existing custom capability. Built-in capabilities cannot be modified.',
    operationId: 'updateCapability',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Capability ID' }],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Capability' } } },
    },
    responses: {
      200: { description: 'Updated capability', content: { 'application/json': { schema: { $ref: '#/components/schemas/Capability' } } } },
      400: { description: 'Cannot modify built-in capability', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'Capability not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useCapabilityStore } from '../../utils/services';
import { requireAuth, canAccessResource } from '../../utils/auth-helpers';

export default defineEventHandler(async (event) => {
  const ctx = requireAuth(event);
  const id = getRouterParam(event, 'id')!;
  const body = await readBody(event);

  const existing = useCapabilityStore().getById(id);
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Capability not found' });
  }
  if (!canAccessResource(ctx, existing, { allowGlobal: false })) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }

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

  const store = useCapabilityStore();

  try {
    return await store.update(id, update);
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message.includes('not found')) {
        throw createError({ statusCode: 404, statusMessage: 'Capability not found' });
      }
      if (err.message.includes('built-in')) {
        throw createError({ statusCode: 400, statusMessage: err.message });
      }
    }
    throw err;
  }
});
