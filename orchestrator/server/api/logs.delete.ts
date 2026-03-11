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

export default defineEventHandler(async () => {
  const logStore = useLogStore();
  await logStore.clear();
  return { ok: true };
});
