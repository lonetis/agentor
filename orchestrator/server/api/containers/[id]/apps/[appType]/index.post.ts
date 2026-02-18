import { useContainerManager } from '../../../../../utils/services';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  const appType = getRouterParam(event, 'appType')!;
  try {
    const containerManager = useContainerManager();
    const result = await containerManager.createAppInstance(id, appType);
    setResponseStatus(event, 201);
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Operation failed';
    throw createError({ statusCode: 500, statusMessage: message });
  }
});
