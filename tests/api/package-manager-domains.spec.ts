import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';

test.describe('Package Manager Domains API', () => {
  test('GET /api/package-manager-domains returns domain list', async ({ request }) => {
    const api = new ApiClient(request);
    const { status, body } = await api.listPackageManagerDomains();
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    // Should have dozens of domains for various package managers
    expect(body.length).toBeGreaterThan(10);
  });

  test('includes npm registry', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.listPackageManagerDomains();
    expect(body.some((d: string) => d.includes('npmjs'))).toBe(true);
  });

  test('includes PyPI', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.listPackageManagerDomains();
    expect(body.some((d: string) => d.includes('pypi'))).toBe(true);
  });

  test('all entries are valid domain strings', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.listPackageManagerDomains();
    for (const domain of body) {
      expect(typeof domain).toBe('string');
      expect(domain.length).toBeGreaterThan(0);
      // Basic domain format check (allow wildcards like *.amazonaws.com)
      expect(domain).toMatch(/^[a-zA-Z0-9*]([a-zA-Z0-9.*-]*[a-zA-Z0-9])?$/);
    }
  });
});
