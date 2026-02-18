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
