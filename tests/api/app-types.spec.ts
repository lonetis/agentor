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

  test('every app type carries the documented base fields', async ({ request }) => {
    // The OpenAPI item schema declares id/displayName/description/ports/
    // maxInstances/singleton — assert the handler actually emits all of them.
    const api = new ApiClient(request);
    const { body } = await api.listAppTypes();
    for (const appType of body) {
      expect(typeof appType.id).toBe('string');
      expect(typeof appType.displayName).toBe('string');
      expect(typeof appType.description).toBe('string');
      expect(Array.isArray(appType.ports)).toBe(true);
      expect(typeof appType.maxInstances).toBe('number');
      expect(typeof appType.singleton).toBe('boolean');
    }
  });

  test('SSH app type exposes fixedInternalPort + autoPortMapping', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.listAppTypes();
    const ssh = body.find((t: { id: string }) => t.id === 'ssh');
    expect(ssh).toBeTruthy();
    expect(ssh.singleton).toBe(true);
    expect(ssh.fixedInternalPort).toBe(22);
    expect(ssh.autoPortMapping).toBeTruthy();
    expect(ssh.autoPortMapping.type).toBe('external');
    expect(typeof ssh.autoPortMapping.externalPortStart).toBe('number');
    expect(typeof ssh.autoPortMapping.externalPortEnd).toBe('number');
    expect(ssh.autoPortMapping.externalPortStart).toBeLessThanOrEqual(ssh.autoPortMapping.externalPortEnd);
  });

  test('VS Code Tunnel app type is a singleton with no ports + no autoPortMapping', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.listAppTypes();
    const vscode = body.find((t: { id: string }) => t.id === 'vscode');
    expect(vscode).toBeTruthy();
    expect(vscode.singleton).toBe(true);
    expect(vscode.ports.length).toBe(0);
    expect(vscode.autoPortMapping).toBeUndefined();
    expect(vscode.fixedInternalPort).toBeUndefined();
  });
});
