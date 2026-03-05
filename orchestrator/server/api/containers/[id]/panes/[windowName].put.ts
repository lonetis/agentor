defineRouteMeta({
  openAPI: {
    tags: ['Tmux'],
    summary: 'Rename tmux window',
    description: 'Renames an existing tmux window.',
    operationId: 'renameTmuxWindow',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Container ID' },
      { name: 'windowName', in: 'path', required: true, schema: { type: 'string' }, description: 'Current window name' },
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
  const windowName = getRouterParam(event, 'windowName')!;
  const body = await readBody(event);

  const newName = typeof body?.newName === 'string' ? body.newName.trim() : '';
  if (!newName) {
    throw createError({ statusCode: 400, statusMessage: 'newName is required' });
  }
  if (!WINDOW_NAME_RE.test(newName)) {
    throw createError({ statusCode: 400, statusMessage: 'newName must be alphanumeric, dashes, or underscores' });
  }

  const containerManager = useContainerManager();
  await containerManager.renameTmuxWindow(id, windowName, newName);
  return { windowName: newName };
});
