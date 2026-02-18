import { useContainerManager } from '../../../utils/services';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  try {
    const containerManager = useContainerManager();
    await containerManager.restart(id);
    return { ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Operation failed';
    throw createError({ statusCode: 500, statusMessage: message });
  }
});
