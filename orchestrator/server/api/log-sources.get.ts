defineRouteMeta({
  openAPI: {
    tags: ['Logs'],
    summary: 'List known log sources',
    operationId: 'getLogSources',
    responses: {
      200: { description: 'Log source list', content: { 'application/json': { schema: { type: 'object', properties: { sources: { type: 'array' } } } } } },
    },
  },
});

import { requireAdmin } from '../utils/auth-helpers';

export default defineEventHandler(async (event) => {
  // Admin-only, matching `logs.get`/`logs.delete` — log sources leak worker
  // container + display names, and the System tab that consumes them is
  // admin-only.
  requireAdmin(event);
  const logStore = useLogStore();
  const sources = await logStore.getLogSources();
  return { sources };
});
