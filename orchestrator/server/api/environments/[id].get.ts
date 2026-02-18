import { useEnvironmentStore } from '../../utils/services';

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')!;
  const env = useEnvironmentStore().get(id);

  if (!env) {
    throw createError({ statusCode: 404, statusMessage: 'Environment not found' });
  }

  return env;
});
