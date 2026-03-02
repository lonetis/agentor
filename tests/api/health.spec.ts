import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';

test.describe('Health API', () => {
  test('GET /api/health returns ok status', async ({ request }) => {
    const api = new ApiClient(request);
    const { status, body } = await api.health();
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(typeof body.containers).toBe('number');
  });

  test('containers count is non-negative', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.health();
    expect(body.containers).toBeGreaterThanOrEqual(0);
  });

  test('health response has exactly status ok', async ({ request }) => {
    const api = new ApiClient(request);
    const { status, body } = await api.health();
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.status).not.toBe('error');
    expect(body.status).not.toBe('degraded');
  });

  test('health response does not expose sensitive info', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.health();
    const keys = Object.keys(body);
    // Should only contain safe fields, no secrets or config leakage
    for (const key of keys) {
      expect(['status', 'containers']).toContain(key);
    }
    expect(body).not.toHaveProperty('config');
    expect(body).not.toHaveProperty('secrets');
    expect(body).not.toHaveProperty('env');
    expect(body).not.toHaveProperty('token');
    expect(body).not.toHaveProperty('apiKey');
  });
});
