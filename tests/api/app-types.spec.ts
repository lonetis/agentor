import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';

test.describe('App Types API', () => {
  test('GET /api/app-types returns app type list', async ({ request }) => {
    const api = new ApiClient(request);
    const { status, body } = await api.listAppTypes();
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  test('Chromium app type exists', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.listAppTypes();
    const chromium = body.find((t: { id: string }) => t.id === 'chromium');
    expect(chromium).toBeTruthy();
    expect(chromium.displayName).toBeTruthy();
    expect(chromium.maxInstances).toBeGreaterThan(0);
    expect(Array.isArray(chromium.ports)).toBe(true);
    expect(chromium.ports.length).toBeGreaterThan(0);
  });

  test('SOCKS5 app type exists', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.listAppTypes();
    const socks5 = body.find((t: { id: string }) => t.id === 'socks5');
    expect(socks5).toBeTruthy();
    expect(socks5.displayName).toBeTruthy();
    expect(socks5.maxInstances).toBeGreaterThan(0);
    expect(Array.isArray(socks5.ports)).toBe(true);
  });

  test('app types have port definitions', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.listAppTypes();
    for (const appType of body) {
      expect(appType.id).toBeTruthy();
      expect(appType.displayName).toBeTruthy();
      expect(typeof appType.maxInstances).toBe('number');
      for (const port of appType.ports) {
        expect(port.id).toBeTruthy();
        expect(port.name).toBeTruthy();
      }
    }
  });
});
