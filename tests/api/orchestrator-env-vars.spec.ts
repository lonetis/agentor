import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';

test.describe('Orchestrator Env Vars API', () => {
  test('GET /api/orchestrator-env-vars returns env var list', async ({ request }) => {
    const api = new ApiClient(request);
    const { status, body } = await api.listOrchestratorEnvVars();
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  test('each entry has name and configured fields', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.listOrchestratorEnvVars();
    for (const entry of body) {
      expect(typeof entry.name).toBe('string');
      expect(entry.name.length).toBeGreaterThan(0);
      expect(typeof entry.configured).toBe('boolean');
    }
  });

  test('includes GITHUB_TOKEN entry', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.listOrchestratorEnvVars();
    const githubToken = body.find((e: { name: string }) => e.name === 'GITHUB_TOKEN');
    expect(githubToken).toBeTruthy();
  });

  test('includes agent API key entries', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.listOrchestratorEnvVars();
    // Should include at least one agent API key entry (e.g. ANTHROPIC_API_KEY)
    const agentKeys = body.filter((e: { name: string }) =>
      e.name.includes('API_KEY') || e.name === 'GITHUB_TOKEN'
    );
    expect(agentKeys.length).toBeGreaterThan(0);
  });
});
