import { useEnvironmentStore } from '../../utils/services';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  const store = useEnvironmentStore();

  try {
    await store.delete(id);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('not found')) {
      throw createError({ statusCode: 404, statusMessage: 'Environment not found' });
    }
    throw err;
  }

  return { ok: true };
});
