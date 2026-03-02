import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';

test.describe('Git Providers API', () => {
  test('GET /api/git-providers returns provider list', async ({ request }) => {
    const api = new ApiClient(request);
    const { status, body } = await api.listGitProviders();
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  test('GitHub provider exists with required fields', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.listGitProviders();
    const github = body.find((p: { id: string }) => p.id === 'github');
    expect(github).toBeTruthy();
    expect(github.displayName).toBe('GitHub');
    expect(github.placeholder).toBeTruthy();
    expect(typeof github.tokenConfigured).toBe('boolean');
  });
});
