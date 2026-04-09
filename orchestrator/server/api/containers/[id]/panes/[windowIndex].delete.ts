defineRouteMeta({
  openAPI: {
    tags: ['Tmux'],
    summary: 'Delete tmux window',
    description: 'Kills a tmux window in the container session.',
    operationId: 'deleteTmuxWindow',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Container ID' },
      { name: 'windowIndex', in: 'path', required: true, schema: { type: 'integer' }, description: 'Tmux window index to delete' },
    ],
    responses: {
      200: { description: 'Window deleted', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
      404: { description: 'Window not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useContainerManager } from '../../../../utils/services';
import { requireContainerAccess } from '../../../../utils/auth-helpers';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  const windowIndex = parseInt(getRouterParam(event, 'windowIndex')!, 10);
  if (Number.isNaN(windowIndex) || windowIndex < 0) {
    throw createError({ statusCode: 400, statusMessage: 'windowIndex must be a non-negative integer' });
  }

  const containerManager = useContainerManager();
  requireContainerAccess(event, containerManager.get(id));
  try {
    await containerManager.killTmuxWindow(id, windowIndex);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'Cannot kill the main tmux window') {
      throw createError({ statusCode: 403, statusMessage: err.message });
    }
    throw err;
  }
  return { ok: true };
});
