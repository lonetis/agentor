import { useContainerManager } from '../../../../../utils/services';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  const appType = getRouterParam(event, 'appType')!;
  const instanceId = getRouterParam(event, 'instanceId')!;
  try {
    const containerManager = useContainerManager();
    await containerManager.stopAppInstance(id, appType, instanceId);
    return { ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Operation failed';
    throw createError({ statusCode: 500, statusMessage: message });
  }
});
