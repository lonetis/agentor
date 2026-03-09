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
    expect(keys).toContain('MAPPER_IMAGE');
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

  test('contains agent-auth section', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getSettings();
    const section = body.find((s: { id: string }) => s.id === 'agent-auth');
    expect(section).toBeTruthy();
    expect(section.label).toBe('Agent Authentication');
    expect(section.items.length).toBeGreaterThan(0);
  });

  test('contains git-providers section', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getSettings();
    const section = body.find((s: { id: string }) => s.id === 'git-providers');
    expect(section).toBeTruthy();
    expect(section.label).toBe('Git Providers');
    expect(section.items.length).toBeGreaterThan(0);
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
