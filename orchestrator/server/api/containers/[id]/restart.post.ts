defineRouteMeta({
  openAPI: {
    tags: ['Containers'],
    summary: 'Restart container',
    description: 'Restarts a worker container.',
    operationId: 'restartContainer',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Container ID' }],
    responses: {
      200: { description: 'Container restarted', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
      404: { description: 'Container not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useContainerManager } from '../../../utils/services';
import { requireContainerAccess } from '../../../utils/auth-helpers';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  try {
    const containerManager = useContainerManager();
    requireContainerAccess(event, containerManager.get(id));
    await containerManager.restart(id);
    return { ok: true };
  } catch (err: unknown) {
    if ((err as any)?.statusCode) throw err;
    const message = err instanceof Error ? err.message : 'Operation failed';
    throw createError({ statusCode: 500, statusMessage: message });
  }
});
