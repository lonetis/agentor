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

  test('reports orchestrator-wide settings only — no per-user secrets', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.listOrchestratorEnvVars();
    const names = body.map((e: { name: string }) => e.name);

    // Per-user secrets MUST NOT be reported here — they live in /api/account/env-vars.
    expect(names).not.toContain('GITHUB_TOKEN');
    expect(names).not.toContain('ANTHROPIC_API_KEY');
    expect(names).not.toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(names).not.toContain('OPENAI_API_KEY');
    expect(names).not.toContain('GEMINI_API_KEY');
  });

  test('includes BASE_DOMAINS entry', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.listOrchestratorEnvVars();
    const baseDomains = body.find((e: { name: string }) => e.name === 'BASE_DOMAINS');
    expect(baseDomains).toBeTruthy();
  });

  test('includes all better-auth entries', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.listOrchestratorEnvVars();
    const names = body.map((e: { name: string }) => e.name);
    expect(names).toContain('BETTER_AUTH_SECRET');
    expect(names).toContain('BETTER_AUTH_URL');
    expect(names).toContain('BETTER_AUTH_TRUSTED_ORIGINS');
    expect(names).toContain('BETTER_AUTH_RP_ID');
  });

  test('includes logging entries', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.listOrchestratorEnvVars();
    const names = body.map((e: { name: string }) => e.name);
    expect(names).toContain('LOG_LEVEL');
    expect(names).toContain('LOG_MAX_SIZE');
    expect(names).toContain('LOG_MAX_FILES');
  });
});
