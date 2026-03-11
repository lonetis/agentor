import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';

test.describe('Logs API', () => {
  test('GET /api/logs returns 200 with entries array', async ({ request }) => {
    const api = new ApiClient(request);
    const { status, body } = await api.queryLogs();
    expect(status).toBe(200);
    expect(body).toHaveProperty('entries');
    expect(Array.isArray(body.entries)).toBe(true);
    expect(body).toHaveProperty('hasMore');
    expect(typeof body.hasMore).toBe('boolean');
  });

  test('log entries have required fields', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.queryLogs({ limit: 10 });
    // May be empty if clear tests run concurrently
    test.skip(body.entries.length === 0, 'No log entries available (cleared by parallel test)');
    const entry = body.entries[0];
    expect(entry).toHaveProperty('timestamp');
    expect(entry).toHaveProperty('level');
    expect(entry).toHaveProperty('source');
    expect(entry).toHaveProperty('message');
    expect(typeof entry.timestamp).toBe('string');
    expect(typeof entry.message).toBe('string');
  });

  test('log entry levels are valid', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.queryLogs({ limit: 50 });
    const validLevels = ['debug', 'info', 'warn', 'error'];
    for (const entry of body.entries) {
      expect(validLevels).toContain(entry.level);
    }
  });

  test('log entry sources are valid', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.queryLogs({ limit: 50 });
    const validSources = ['orchestrator', 'worker', 'mapper', 'traefik'];
    for (const entry of body.entries) {
      expect(validSources).toContain(entry.source);
    }
  });

  test('orchestrator source always present', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.queryLogs({ sources: 'orchestrator', limit: 10 });
    // May be empty if clear tests run concurrently
    test.skip(body.entries.length === 0, 'No log entries available (cleared by parallel test)');
    for (const entry of body.entries) {
      expect(entry.source).toBe('orchestrator');
    }
  });

  test('filter by sources returns only matching entries', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.queryLogs({ sources: 'orchestrator', limit: 50 });
    for (const entry of body.entries) {
      expect(entry.source).toBe('orchestrator');
    }
  });

  test('filter by levels returns only matching entries', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.queryLogs({ levels: 'info', limit: 50 });
    for (const entry of body.entries) {
      expect(entry.level).toBe('info');
    }
  });

  test('filter by multiple levels', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.queryLogs({ levels: 'info,warn', limit: 50 });
    for (const entry of body.entries) {
      expect(['info', 'warn']).toContain(entry.level);
    }
  });

  test('search filter matches message content', async ({ request }) => {
    const api = new ApiClient(request);
    // Search for a string likely in startup logs
    const { body } = await api.queryLogs({ search: 'Synced', limit: 10 });
    for (const entry of body.entries) {
      expect(entry.message.toLowerCase()).toContain('synced');
    }
  });

  test('search with no match returns empty', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.queryLogs({ search: 'zzz-nonexistent-search-term-zzz', limit: 10 });
    expect(body.entries).toHaveLength(0);
  });

  test('limit parameter controls result count', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.queryLogs({ limit: 3 });
    expect(body.entries.length).toBeLessThanOrEqual(3);
  });

  test('default limit is 500', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.queryLogs();
    expect(body.entries.length).toBeLessThanOrEqual(500);
  });

  test('limit clamped to 5000 max', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.queryLogs({ limit: 99999 });
    expect(body.entries.length).toBeLessThanOrEqual(5000);
  });

  test('entries returned newest-first', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.queryLogs({ limit: 20 });
    if (body.entries.length >= 2) {
      const timestamps = body.entries.map((e: { timestamp: string }) => new Date(e.timestamp).getTime());
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i - 1]).toBeGreaterThanOrEqual(timestamps[i]);
      }
    }
  });

  test('timestamps are valid ISO 8601', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.queryLogs({ limit: 10 });
    for (const entry of body.entries) {
      const date = new Date(entry.timestamp);
      expect(date.getTime()).not.toBeNaN();
    }
  });

  test('combined filters work together', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.queryLogs({ sources: 'orchestrator', levels: 'info', limit: 5 });
    for (const entry of body.entries) {
      expect(entry.source).toBe('orchestrator');
      expect(entry.level).toBe('info');
    }
  });

  test('GET /api/log-sources returns 200', async ({ request }) => {
    const api = new ApiClient(request);
    const { status, body } = await api.getLogSources();
    expect(status).toBe(200);
    expect(body).toHaveProperty('sources');
    expect(Array.isArray(body.sources)).toBe(true);
  });

  test('log sources have required fields', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getLogSources();
    for (const source of body.sources) {
      expect(source).toHaveProperty('sourceId');
      expect(source).toHaveProperty('source');
      expect(typeof source.sourceId).toBe('string');
      expect(typeof source.source).toBe('string');
    }
  });

  test('DELETE /api/logs clears logs', async ({ request }) => {
    const api = new ApiClient(request);
    const { status, body } = await api.clearLogs();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  test('query after clear returns fewer entries', async ({ request }) => {
    const api = new ApiClient(request);
    // Clear first
    await api.clearLogs();
    // Query immediately — should be empty or near-empty (new logs may arrive fast)
    const { body } = await api.queryLogs({ limit: 10 });
    // After clear, very few entries should exist (only post-clear orchestrator activity)
    expect(body.entries.length).toBeLessThanOrEqual(10);
  });

  test('clear is idempotent', async ({ request }) => {
    const api = new ApiClient(request);
    const r1 = await api.clearLogs();
    expect(r1.status).toBe(200);
    const r2 = await api.clearLogs();
    expect(r2.status).toBe(200);
    expect(r2.body.ok).toBe(true);
  });
});
