import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';

test.describe('Init Presets API', () => {
  test('GET /api/init-presets returns preset list', async ({ request }) => {
    const api = new ApiClient(request);
    const { status, body } = await api.listInitPresets();
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  test('each preset has required fields', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.listInitPresets();
    for (const preset of body) {
      expect(preset.id).toBeTruthy();
      expect(preset.displayName).toBeTruthy();
      expect(preset.script).toBeTruthy();
      expect(Array.isArray(preset.apiDomains)).toBe(true);
    }
  });

  test('Claude preset exists', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.listInitPresets();
    const claude = body.find((p: { id: string }) => p.id === 'claude');
    expect(claude).toBeTruthy();
    expect(claude.displayName).toContain('Claude');
  });

  test('Codex preset exists', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.listInitPresets();
    const codex = body.find((p: { id: string }) => p.id === 'codex');
    expect(codex).toBeTruthy();
    expect(codex.displayName).toContain('Codex');
  });

  test('Gemini preset exists', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.listInitPresets();
    const gemini = body.find((p: { id: string }) => p.id === 'gemini');
    expect(gemini).toBeTruthy();
    expect(gemini.displayName).toContain('Gemini');
  });

  test('presets have API domains for firewall passthrough', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.listInitPresets();
    for (const preset of body) {
      expect(preset.apiDomains.length).toBeGreaterThan(0);
    }
  });
});
