import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';

test.describe('Settings API', () => {
  test('GET /api/settings returns 200 with array', async ({ request }) => {
    const api = new ApiClient(request);
    const { status, body } = await api.getSettings();
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  test('settings array is non-empty', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getSettings();
    expect(body.length).toBeGreaterThan(0);
  });

  test('contains docker section with expected items', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getSettings();
    const docker = body.find((s: { id: string }) => s.id === 'docker');
    expect(docker).toBeTruthy();
    expect(docker.label).toBe('Docker & Infrastructure');

    const keys = docker.items.map((i: { key: string }) => i.key);
    expect(keys).toContain('DOCKER_NETWORK');
    expect(keys).toContain('CONTAINER_PREFIX');
    expect(keys).toContain('WORKER_IMAGE');
    expect(keys).toContain('ORCHESTRATOR_IMAGE');
    expect(keys).toContain('DATA_VOLUME');
    expect(keys).toContain('DATA_DIR');
  });

  test('contains worker-defaults section', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getSettings();
    const section = body.find((s: { id: string }) => s.id === 'worker-defaults');
    expect(section).toBeTruthy();
    expect(section.label).toBe('Worker Defaults');
    expect(section.items.length).toBeGreaterThan(0);
  });

  test('does NOT contain agent-auth section (per-user, lives in Account modal)', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getSettings();
    const section = body.find((s: { id: string }) => s.id === 'agent-auth');
    expect(section).toBeUndefined();
  });

  test('git-providers section exists but contains only clone domains, not tokens', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getSettings();
    const section = body.find((s: { id: string }) => s.id === 'git-providers');
    expect(section).toBeTruthy();
    expect(section.label).toBe('Git Providers');

    // No `*Token` items — per-user tokens belong to /api/account/env-vars.
    const keys = section.items.map((i: { key: string }) => i.key);
    expect(keys.some((k: string) => /token/i.test(k))).toBe(false);
    // Clone domain entries should still be present — one per provider.
    expect(keys).toEqual(expect.arrayContaining(['github.cloneDomains', 'gitlab.cloneDomains']));
  });

  test('git-providers section lists the configured self-managed GitLab instances', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getSettings();
    const section = body.find((s: { id: string }) => s.id === 'git-providers');
    const item = section.items.find((i: { key: string }) => i.key === 'GITLAB_INSTANCES');
    expect(item).toBeTruthy();
    const providers = (await api.listGitProviders()).body as { id: string; url: string }[];
    const instances = providers.filter((p) => p.id.startsWith('gitlab-'));
    if (instances.length === 0) {
      expect(item.value).toBe('none');
    } else {
      expect(item.type).toBe('list');
      expect(item.value).toEqual(instances.map((p) => `${p.id.slice('gitlab-'.length)}=${p.url}`));
      for (const p of instances) {
        expect(section.items.map((i: { key: string }) => i.key)).toContain(`${p.id}.cloneDomains`);
      }
    }
  });

  test('contains network section', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getSettings();
    const section = body.find((s: { id: string }) => s.id === 'network');
    expect(section).toBeTruthy();
    expect(section.label).toBe('Network');
    expect(section.items.length).toBeGreaterThan(0);
  });

  test('contains init-scripts section with scripts', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getSettings();
    const section = body.find((s: { id: string }) => s.id === 'init-scripts');
    expect(section).toBeTruthy();
    expect(section.label).toBe('Init Scripts');
    expect(section.items.length).toBeGreaterThan(0);
  });

  test('contains logging section with log config', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getSettings();
    const section = body.find((s: { id: string }) => s.id === 'logging');
    expect(section).toBeTruthy();
    expect(section.label).toBe('Logging');
    const keys = section.items.map((i: { key: string }) => i.key);
    expect(keys).toContain('LOG_LEVEL');
    expect(keys).toContain('LOG_MAX_SIZE');
    expect(keys).toContain('LOG_MAX_FILES');
  });

  test('contains authentication section with better-auth config', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getSettings();
    const section = body.find((s: { id: string }) => s.id === 'authentication');
    expect(section).toBeTruthy();
    expect(section.label).toBe('Authentication');
    const keys = section.items.map((i: { key: string }) => i.key);
    expect(keys).toContain('BETTER_AUTH_SECRET');
    expect(keys).toContain('BETTER_AUTH_URL');
    expect(keys).toContain('BETTER_AUTH_TRUSTED_ORIGINS');
    expect(keys).toContain('BETTER_AUTH_RP_ID');
    // MCP server status (the OAuth-protected /mcp URL, or why it is disabled).
    const mcp = section.items.find((i: { key: string }) => i.key === 'MCP_ENABLED');
    expect(mcp.value).toMatch(/\/mcp$|^disabled/);
    // The session secret is sensitive and exposed only as a status value.
    const secret = section.items.find((i: { key: string }) => i.key === 'BETTER_AUTH_SECRET');
    expect(secret.type).toBe('status');
    expect(secret.sensitive).toBe(true);
  });

  test('contains app-types section with app definitions', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getSettings();
    const section = body.find((s: { id: string }) => s.id === 'app-types');
    expect(section).toBeTruthy();
    expect(section.label).toBe('App Types');
    expect(section.items.length).toBeGreaterThan(0);
  });

  test('each section has id, label, and items array', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getSettings();
    for (const section of body) {
      expect(typeof section.id).toBe('string');
      expect(section.id.length).toBeGreaterThan(0);
      expect(typeof section.label).toBe('string');
      expect(section.label.length).toBeGreaterThan(0);
      expect(Array.isArray(section.items)).toBe(true);
    }
  });

  test('each item has key, label, value, and type fields', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getSettings();
    const validTypes = ['string', 'number', 'boolean', 'list', 'status'];
    for (const section of body) {
      for (const item of section.items) {
        expect(typeof item.key).toBe('string');
        expect(item.key.length).toBeGreaterThan(0);
        expect(typeof item.label).toBe('string');
        expect(item.label.length).toBeGreaterThan(0);
        expect(item).toHaveProperty('value');
        expect(validTypes).toContain(item.type);
      }
    }
  });
});
