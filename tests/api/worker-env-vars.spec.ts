import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';

test.describe('Worker System Env Vars API', () => {
  test('GET /api/worker-env-vars returns the worker system env var list', async ({ request }) => {
    const api = new ApiClient(request);
    const { status, body } = await api.listWorkerEnvVars();
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  test('each entry has name and description fields', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.listWorkerEnvVars();
    for (const entry of body) {
      expect(typeof entry.name).toBe('string');
      expect(entry.name.length).toBeGreaterThan(0);
      expect(typeof entry.description).toBe('string');
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  test('includes the env vars the orchestrator injects into every worker', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.listWorkerEnvVars();
    const names = body.map((e: { name: string }) => e.name);

    // Structured JSON payloads + infrastructural vars the worker actually receives.
    expect(names).toContain('ENVIRONMENT');
    expect(names).toContain('CAPABILITIES');
    expect(names).toContain('INSTRUCTIONS');
    expect(names).toContain('WORKER');
    expect(names).toContain('ORCHESTRATOR_URL');
    expect(names).toContain('WORKER_CONTAINER_NAME');
    expect(names).toContain('EXPOSE_PORT_MAPPINGS');
    expect(names).toContain('EXPOSE_DOMAIN_MAPPINGS');
    expect(names).toContain('EXPOSE_USAGE');
  });

  test('does NOT leak orchestrator-wide settings (never passed to workers)', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.listWorkerEnvVars();
    const names = body.map((e: { name: string }) => e.name);

    // Orchestrator-only config — these are NOT passed to worker containers and
    // must never appear in the worker env list (regression guard).
    expect(names).not.toContain('BETTER_AUTH_SECRET');
    expect(names).not.toContain('BETTER_AUTH_URL');
    expect(names).not.toContain('BETTER_AUTH_TRUSTED_ORIGINS');
    expect(names).not.toContain('BETTER_AUTH_RP_ID');
    expect(names).not.toContain('DASHBOARD_AUTH_USER');
    expect(names).not.toContain('DASHBOARD_AUTH_PASSWORD');
    expect(names).not.toContain('BASE_DOMAINS');
    expect(names).not.toContain('ACME_EMAIL');
    expect(names).not.toContain('LOG_LEVEL');
    expect(names).not.toContain('LOG_MAX_SIZE');
    expect(names).not.toContain('LOG_MAX_FILES');
  });

  test('does NOT include per-user secrets (those live in /api/account/env-vars)', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.listWorkerEnvVars();
    const names = body.map((e: { name: string }) => e.name);

    expect(names).not.toContain('GITHUB_TOKEN');
    expect(names).not.toContain('ANTHROPIC_API_KEY');
    expect(names).not.toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(names).not.toContain('OPENAI_API_KEY');
    expect(names).not.toContain('GEMINI_API_KEY');
  });
});
