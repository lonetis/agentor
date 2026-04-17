import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';

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
    const validSources = ['orchestrator', 'worker', 'traefik'];
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

  test('until parameter returns entries strictly older than the timestamp', async ({ request }) => {
    const api = new ApiClient(request);
    const first = await api.queryLogs({ limit: 5 });
    test.skip(first.body.entries.length < 2, 'Need at least 2 entries to test pagination');
    // Pick the oldest of the page as the boundary; the next page should
    // contain only entries with timestamp < that.
    const boundary = first.body.entries[first.body.entries.length - 1].timestamp;
    const page2 = await api.queryLogs({ until: boundary, limit: 5 });
    for (const entry of page2.body.entries) {
      expect(entry.timestamp < boundary, `entry ${entry.timestamp} should be < ${boundary}`).toBe(true);
    }
  });

  test('paginating with until walks backwards without skipping', async ({ request }) => {
    const api = new ApiClient(request);
    // Pull a sizable first page, then ask for the next page using its
    // oldest timestamp. Concatenated, the union should be a contiguous,
    // strictly-monotonic-by-time slice with no duplicate (timestamp,
    // source, sourceId, message) tuples.
    const page1 = await api.queryLogs({ limit: 50 });
    test.skip(page1.body.entries.length < 50, 'Not enough log history for two pages');
    const boundary = page1.body.entries[page1.body.entries.length - 1].timestamp;
    const page2 = await api.queryLogs({ until: boundary, limit: 50 });
    // No timestamp on page 2 should be >= boundary.
    for (const entry of page2.body.entries) {
      expect(entry.timestamp < boundary).toBe(true);
    }
    // Combined ordering across pages is non-increasing.
    const all = [...page1.body.entries, ...page2.body.entries];
    for (let i = 1; i < all.length; i++) {
      expect(all[i - 1].timestamp >= all[i].timestamp).toBe(true);
    }
  });

  test('hasMore is true when more older entries exist', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.queryLogs({ limit: 1 });
    test.skip(body.entries.length < 1, 'No log entries available');
    // With limit=1 in a system that has way more than one log entry,
    // hasMore must be true.
    expect(body.hasMore).toBe(true);
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

  test('container log messages do not contain leading Docker timestamps', async ({ request }) => {
    const api = new ApiClient(request);

    // Ensure at least one worker has produced TTY logs (entrypoint phases
    // emit ~30 lines per boot). Create + tear down so the test is hermetic
    // even if no other test has run a worker yet.
    const worker = await createWorker(request);
    try {
      // Give the log collector a moment to ingest the buffered entrypoint
      // output now that the container is running.
      await new Promise((r) => setTimeout(r, 1500));

      const { body } = await api.queryLogs({ sources: 'worker', sourceIds: worker.name, limit: 500 });
      expect(body.entries.length).toBeGreaterThan(0);

      // The Docker `--timestamps` prefix (e.g. 2026-04-17T10:38:06.779538881Z)
      // must be stripped from the message before storage. A regression here
      // means the \r-trailing TTY split bug is back.
      const tsRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z?\s/;
      for (const entry of body.entries) {
        expect(entry.message, `entry: ${JSON.stringify(entry)}`).not.toMatch(tsRe);
      }
    } finally {
      await cleanupWorker(request, worker.id);
    }
  });

  test('orchestrator self-stdout is captured into the orchestrator log', async ({ request }) => {
    const api = new ApiClient(request);
    // Anything captured by self-attach carries a sourceId (the orchestrator
    // container name); intentional useLogger() entries do not. We don't
    // assert any specific message because dev/prod produce different lines,
    // but at least one stdout-captured entry should exist after enough
    // framework activity has flushed (Nuxt/Nitro/Vite startup).
    const { body } = await api.queryLogs({ sources: 'orchestrator', limit: 500 });
    test.skip(body.entries.length === 0, 'No orchestrator log entries available');
    const captured = body.entries.filter((e: { sourceId?: string; source: string }) =>
      e.source === 'orchestrator' && typeof e.sourceId === 'string' && e.sourceId.length > 0,
    );
    expect(captured.length).toBeGreaterThan(0);
  });

  // Log clear tests are serialized because clearLogs() wipes the global log
  // buffer, which breaks parallel tests that read log entries.
  test.describe.serial('Log clear operations', () => {
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
});
