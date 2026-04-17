import type { LogLevel, LogSource } from '../../shared/types';

defineRouteMeta({
  openAPI: {
    tags: ['Logs'],
    summary: 'Query log entries',
    operationId: 'getLogs',
    parameters: [
      { name: 'sources', in: 'query', schema: { type: 'string' }, description: 'Comma-separated log sources (orchestrator,worker,traefik)' },
      { name: 'sourceIds', in: 'query', schema: { type: 'string' }, description: 'Comma-separated container names' },
      { name: 'levels', in: 'query', schema: { type: 'string' }, description: 'Comma-separated log levels (debug,info,warn,error)' },
      { name: 'since', in: 'query', schema: { type: 'string' }, description: 'ISO 8601 timestamp (entries after this time)' },
      { name: 'until', in: 'query', schema: { type: 'string' }, description: 'ISO 8601 timestamp (entries before this time)' },
      { name: 'limit', in: 'query', schema: { type: 'integer', default: 500 }, description: 'Max entries to return (max 5000)' },
      { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Substring search in message' },
    ],
    responses: {
      200: { description: 'Log entries', content: { 'application/json': { schema: { type: 'object', properties: { entries: { type: 'array' }, hasMore: { type: 'boolean' } } } } } },
    },
  },
});

import { requireAdmin } from '../utils/auth-helpers';

export default defineEventHandler(async (event) => {
  requireAdmin(event);
  const query = getQuery(event);

  const sources = query.sources ? String(query.sources).split(',').filter(Boolean) as LogSource[] : undefined;
  const sourceIds = query.sourceIds ? String(query.sourceIds).split(',').filter(Boolean) : undefined;
  const levels = query.levels ? String(query.levels).split(',').filter(Boolean) as LogLevel[] : undefined;
  const since = query.since ? String(query.since) : undefined;
  const until = query.until ? String(query.until) : undefined;
  const limit = query.limit ? Math.min(parseInt(String(query.limit), 10) || 500, 5000) : 500;
  const search = query.search ? String(query.search) : undefined;

  const logStore = useLogStore();
  return logStore.query({ sources, sourceIds, levels, since, until, limit, search });
});
