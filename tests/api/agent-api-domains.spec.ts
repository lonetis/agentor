import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';

test.describe('Agent API Domains', () => {
  test('GET /api/agent-api-domains returns 200 with array', async ({ request }) => {
    const api = new ApiClient(request);
    const { status, body } = await api.listAgentApiDomains();
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  test('array is non-empty', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.listAgentApiDomains();
    expect(body.length).toBeGreaterThan(0);
  });

  test('all entries are non-empty strings', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.listAgentApiDomains();
    for (const domain of body) {
      expect(typeof domain).toBe('string');
      expect(domain.length).toBeGreaterThan(0);
    }
  });

  test('contains known domain api.anthropic.com', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.listAgentApiDomains();
    expect(body).toContain('api.anthropic.com');
  });

  test('no duplicates in the array', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.listAgentApiDomains();
    const unique = new Set(body);
    expect(unique.size).toBe(body.length);
  });
});
