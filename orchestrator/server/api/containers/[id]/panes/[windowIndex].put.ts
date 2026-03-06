defineRouteMeta({
  openAPI: {
    tags: ['Tmux'],
    summary: 'Rename tmux window',
    description: 'Renames an existing tmux window.',
    operationId: 'renameTmuxWindow',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Container ID' },
      { name: 'windowIndex', in: 'path', required: true, schema: { type: 'integer' }, description: 'Tmux window index' },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['newName'],
            properties: {
              newName: { type: 'string', description: 'New window name' },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'Window renamed', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
      400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useContainerManager } from '../../../../utils/services';
import { WINDOW_NAME_RE } from '../../../../utils/validation';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  const windowIndex = parseInt(getRouterParam(event, 'windowIndex')!, 10);
  if (Number.isNaN(windowIndex) || windowIndex < 0) {
    throw createError({ statusCode: 400, statusMessage: 'windowIndex must be a non-negative integer' });
  }
  const body = await readBody(event);

  const newName = typeof body?.newName === 'string' ? body.newName.trim() : '';
  if (!newName) {
    throw createError({ statusCode: 400, statusMessage: 'newName is required' });
  }
  if (!WINDOW_NAME_RE.test(newName)) {
    throw createError({ statusCode: 400, statusMessage: 'newName must be alphanumeric, dashes, or underscores' });
  }

  const containerManager = useContainerManager();
  await containerManager.renameTmuxWindow(id, windowIndex, newName);
  return { windowName: newName };
});
