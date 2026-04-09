defineRouteMeta({
  openAPI: {
    tags: ['Containers'],
    summary: 'Archive container',
    description: 'Archives a worker container, keeping its workspace volume.',
    operationId: 'archiveContainer',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Container ID' }],
    responses: {
      200: { description: 'Container archived', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
      404: { description: 'Container not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useContainerManager } from '../../../utils/services';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  try {
    await useContainerManager().archive(id);
    return { ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Operation failed';
    throw createError({ statusCode: 500, statusMessage: message });
  }
});
