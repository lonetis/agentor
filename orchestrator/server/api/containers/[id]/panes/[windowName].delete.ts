defineRouteMeta({
  openAPI: {
    tags: ['Tmux'],
    summary: 'Delete tmux window',
    description: 'Kills a tmux window in the container session.',
    operationId: 'deleteTmuxWindow',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Container ID' },
      { name: 'windowName', in: 'path', required: true, schema: { type: 'string' }, description: 'Window name to delete' },
    ],
    responses: {
      200: { description: 'Window deleted', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
      404: { description: 'Window not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useContainerManager } from '../../../../utils/services';
import { WINDOW_NAME_RE } from '../../../../utils/validation';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  const windowName = getRouterParam(event, 'windowName')!;

  if (!WINDOW_NAME_RE.test(windowName)) {
    throw createError({ statusCode: 400, statusMessage: 'windowName must be alphanumeric, dashes, or underscores' });
  }

  const containerManager = useContainerManager();
  try {
    await containerManager.killTmuxWindow(id, windowName);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'Cannot kill the main tmux window') {
      throw createError({ statusCode: 403, statusMessage: err.message });
    }
    throw err;
  }
  return { ok: true };
});
