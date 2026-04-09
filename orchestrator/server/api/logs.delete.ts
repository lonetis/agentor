defineRouteMeta({
  openAPI: {
    tags: ['Logs'],
    summary: 'Clear all log files',
    operationId: 'clearLogs',
    responses: {
      200: { description: 'Logs cleared', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' } } } } } },
    },
  },
});

import { requireAdmin } from '../utils/auth-helpers';

export default defineEventHandler(async (event) => {
  requireAdmin(event);
  const logStore = useLogStore();
  await logStore.clear();
  return { ok: true };
});
