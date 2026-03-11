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

export default defineEventHandler(async () => {
  const logStore = useLogStore();
  const sources = await logStore.getLogSources();
  return { sources };
});
