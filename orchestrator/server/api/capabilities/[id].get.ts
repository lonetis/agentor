defineRouteMeta({
  openAPI: {
    tags: ['Capabilities'],
    summary: 'Get capability',
    description: 'Returns a single capability by ID.',
    operationId: 'getCapability',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Capability ID' }],
    responses: {
      200: { description: 'Capability details', content: { 'application/json': { schema: { $ref: '#/components/schemas/Capability' } } } },
      404: { description: 'Capability not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useCapabilityStore } from '../../utils/services';

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')!;
  const capability = useCapabilityStore().get(id);

  if (!capability) {
    throw createError({ statusCode: 404, statusMessage: 'Capability not found' });
  }

  return capability;
});
