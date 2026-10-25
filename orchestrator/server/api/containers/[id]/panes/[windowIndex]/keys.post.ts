defineRouteMeta({
  openAPI: {
    tags: ['Tmux'],
    summary: 'Send keystrokes to a tmux window',
    description: 'Types into a tmux window exactly as a user at the terminal would — the way to talk to an agent CLI (Claude, Codex, Antigravity) or any interactive program running in a worker. Applied in order: `keys` (tmux key names, e.g. `C-c`, `Escape`, `Up`, `Tab`), then `text` (typed literally), then Enter when `enter` is true. Window 0 runs the worker\'s init script (usually the agent). Read the result with the capture endpoint.',
    operationId: 'sendTmuxKeys',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Worker ID' },
      { name: 'windowIndex', in: 'path', required: true, schema: { type: 'integer', minimum: 0 }, description: 'tmux window index (0 = main window)' },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              keys: { type: 'array', items: { type: 'string' }, description: 'tmux key names sent before the text, e.g. ["C-c"] or ["Down", "Enter"]' },
              text: { type: 'string', description: 'Literal text to type' },
              enter: { type: 'boolean', description: 'Press Enter after the text' },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'Keys sent', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
      400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'Worker or window not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      409: { description: 'Worker not running', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useContainerManager } from '../../../../../utils/services';
import { requireRunningContainerAccess } from '../../../../../utils/auth-helpers';
import { rethrowTmuxError } from '../../../../../utils/http-errors';

/** tmux key names (`C-c`, `M-Left`, `Enter`, `F5`, …); never starting with `-`. */
const TMUX_KEY_RE = /^[A-Za-z0-9_+][A-Za-z0-9_+\-]{0,31}$/;

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  const containerManager = useContainerManager();
  requireRunningContainerAccess(event, containerManager.get(id));

  const windowIndex = Number(getRouterParam(event, 'windowIndex'));
  if (!Number.isInteger(windowIndex) || windowIndex < 0) {
    throw createError({ statusCode: 400, statusMessage: 'windowIndex must be a non-negative integer' });
  }
  const body = (await readBody(event)) ?? {};
  if (body.keys !== undefined && (!Array.isArray(body.keys) || !body.keys.every((k: unknown) => typeof k === 'string' && TMUX_KEY_RE.test(k)))) {
    throw createError({ statusCode: 400, statusMessage: 'keys must be an array of tmux key names (e.g. "C-c", "Enter", "Up")' });
  }
  if (body.text !== undefined && typeof body.text !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'text must be a string' });
  }
  if (body.enter !== undefined && typeof body.enter !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'enter must be a boolean' });
  }
  if (!body.keys?.length && !body.text && !body.enter) {
    throw createError({ statusCode: 400, statusMessage: 'Provide at least one of keys, text or enter' });
  }

  try {
    await containerManager.sendTmuxKeys(id, windowIndex, { keys: body.keys, text: body.text, enter: body.enter });
    return { ok: true };
  } catch (err) {
    rethrowTmuxError(err);
  }
});
