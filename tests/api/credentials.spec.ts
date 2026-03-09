import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';

test.describe('Credentials API', () => {
  test('GET /api/credentials returns 200 with array', async ({ request }) => {
    const api = new ApiClient(request);
    const { status, body } = await api.listCredentials();
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  test('array is non-empty with at least 3 agent credential mappings', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.listCredentials();
    expect(body.length).toBeGreaterThanOrEqual(3);
  });

  test('each entry has agentId, fileName, and configured', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.listCredentials();
    for (const entry of body) {
      expect(typeof entry.agentId).toBe('string');
      expect(typeof entry.fileName).toBe('string');
      expect(typeof entry.configured).toBe('boolean');
    }
  });

  test('agentId is one of the known agents', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.listCredentials();
    const knownAgents = ['claude', 'codex', 'gemini'];
    for (const entry of body) {
      expect(knownAgents).toContain(entry.agentId);
    }
  });

  test('configured is boolean for every entry', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.listCredentials();
    for (const entry of body) {
      expect(entry.configured === true || entry.configured === false).toBe(true);
    }
  });

  test('fileName is a non-empty string for every entry', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.listCredentials();
    for (const entry of body) {
      expect(typeof entry.fileName).toBe('string');
      expect(entry.fileName.length).toBeGreaterThan(0);
    }
  });
});
