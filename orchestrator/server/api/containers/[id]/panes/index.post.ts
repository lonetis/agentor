defineRouteMeta({
  openAPI: {
    tags: ['Tmux'],
    summary: 'Create tmux window',
    description: 'Creates a new tmux window in the container session.',
    operationId: 'createTmuxWindow',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Container ID' }],
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Window name (auto-generated if omitted)' },
            },
          },
        },
      },
    },
    responses: {
      201: { description: 'Created tmux window', content: { 'application/json': { schema: { $ref: '#/components/schemas/TmuxWindow' } } } },
      400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useContainerManager } from '../../../../utils/services';
import { WINDOW_NAME_RE } from '../../../../utils/validation';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  const body = await readBody(event);

  const name = typeof body?.name === 'string' ? body.name.trim() : undefined;
  if (name && !WINDOW_NAME_RE.test(name)) {
    throw createError({ statusCode: 400, statusMessage: 'name must be alphanumeric, dashes, or underscores' });
  }

  const containerManager = useContainerManager();
  const windowName = await containerManager.createTmuxWindow(id, name || undefined);
  setResponseStatus(event, 201);
  return { windowName };
});
