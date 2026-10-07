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
    expect(github.type).toBe('github');
    expect(github.displayName).toBe('GitHub');
    expect(github.url).toBe('https://github.com');
    expect(github.placeholder).toBeTruthy();
    expect(github.tokenEnvVar).toBe('GITHUB_TOKEN');
    expect(typeof github.tokenConfigured).toBe('boolean');
  });

  test('gitlab.com provider is built in', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.listGitProviders();
    const gitlab = body.find((p: { id: string }) => p.id === 'gitlab');
    expect(gitlab).toMatchObject({ type: 'gitlab', displayName: 'GitLab', url: 'https://gitlab.com', tokenEnvVar: 'GITLAB_TOKEN' });
    expect(typeof gitlab.tokenConfigured).toBe('boolean');
  });

  test('every provider has a unique id and a valid token env var name', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.listGitProviders();
    const ids = body.map((p: { id: string }) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of body) {
      expect(['github', 'gitlab']).toContain(p.type);
      expect(p.tokenEnvVar).toMatch(/^[A-Z_][A-Z0-9_]*$/);
      expect(p.url).toMatch(/^https?:\/\/[^/]+/);
      expect(p.url.endsWith('/')).toBe(false);
    }
  });
});
