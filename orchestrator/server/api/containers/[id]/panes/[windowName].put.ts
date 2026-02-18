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
