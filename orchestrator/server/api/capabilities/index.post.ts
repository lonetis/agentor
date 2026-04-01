defineRouteMeta({
  openAPI: {
    tags: ['Capabilities'],
    summary: 'Create capability',
    description: 'Creates a new custom capability.',
    operationId: 'createCapability',
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Capability' } } },
    },
    responses: {
      201: { description: 'Created capability', content: { 'application/json': { schema: { $ref: '#/components/schemas/Capability' } } } },
      400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useCapabilityStore } from '../../utils/services';

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (!body.name || typeof body.name !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'name is required' });
  }
  if (!body.content || typeof body.content !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'content is required' });
  }

  const store = useCapabilityStore();
  const capability = await store.create({ name: body.name, content: body.content });
  setResponseStatus(event, 201);
  return capability;
});
