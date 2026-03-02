import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';

test.describe('GitHub API', () => {
  test.describe('GET /api/github/repos', () => {
    test('returns repos response', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.listGitHubRepos();
      expect(status).toBe(200);
      expect(Array.isArray(body.repos)).toBe(true);
      expect(typeof body.tokenConfigured).toBe('boolean');
    });

    test('returns username when token configured', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.listGitHubRepos();
      if (body.tokenConfigured) {
        expect(typeof body.username).toBe('string');
        expect(body.username.length).toBeGreaterThan(0);
      }
    });

    test('returns orgs when token configured', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.listGitHubRepos();
      if (body.tokenConfigured) {
        expect(Array.isArray(body.orgs)).toBe(true);
      }
    });

    test('repo objects have required fields when token configured', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.listGitHubRepos();
      if (body.tokenConfigured && body.repos.length > 0) {
        const repo = body.repos[0];
        expect(typeof repo.fullName).toBe('string');
        expect(repo.fullName).toContain('/');
        expect(typeof repo.private).toBe('boolean');
        expect(typeof repo.defaultBranch).toBe('string');
      }
    });
  });

  test.describe('GET /api/github/repos/:owner/:repo/branches', () => {
    test('returns branches for a known repo when token configured', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: repoData } = await api.listGitHubRepos();

      if (repoData.tokenConfigured && repoData.repos.length > 0) {
        // Repos have fullName (e.g., "owner/repo"), split to get owner and name
        const [owner, repo] = repoData.repos[0].fullName.split('/');
        const { status, body } = await api.listGitHubBranches(owner, repo);
        expect(status).toBe(200);
        expect(Array.isArray(body.branches)).toBe(true);
        expect(typeof body.defaultBranch).toBe('string');
      }
    });

    test('returns 400 when token not configured', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: repoData } = await api.listGitHubRepos();

      if (!repoData.tokenConfigured) {
        const { status } = await api.listGitHubBranches('octocat', 'Hello-World');
        expect(status).toBe(400);
      }
    });

    test('branch objects have name field when token configured', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: repoData } = await api.listGitHubRepos();

      if (repoData.tokenConfigured && repoData.repos.length > 0) {
        const [owner, repo] = repoData.repos[0].fullName.split('/');
        const { body } = await api.listGitHubBranches(owner, repo);
        if (body.branches.length > 0) {
          expect(typeof body.branches[0].name).toBe('string');
          expect(body.branches[0].name.length).toBeGreaterThan(0);
        }
      }
    });
  });

  test.describe('POST /api/github/repos', () => {
    test('rejects missing owner', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createGitHubRepo({ name: 'test-repo' });
      expect(status).toBe(400);
    });

    test('rejects missing name', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createGitHubRepo({ owner: 'test-owner' });
      expect(status).toBe(400);
    });

    test('rejects when token not configured', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: repoData } = await api.listGitHubRepos();

      if (!repoData.tokenConfigured) {
        const { status } = await api.createGitHubRepo({ owner: 'test-owner', name: 'test-repo' });
        expect(status).toBe(400);
      }
    });

    test('rejects empty owner string', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createGitHubRepo({ owner: '', name: 'test-repo' });
      expect(status).toBe(400);
    });

    test('rejects empty name string', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createGitHubRepo({ owner: 'test-owner', name: '' });
      expect(status).toBe(400);
    });
  });

  test.describe('Response shape validation', () => {
    test('repo list response always has expected shape', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.listGitHubRepos();
      expect(status).toBe(200);
      // Whether token is configured or not, response must have these fields
      expect(body).toHaveProperty('repos');
      expect(body).toHaveProperty('tokenConfigured');
      expect(Array.isArray(body.repos)).toBe(true);
      expect(typeof body.tokenConfigured).toBe('boolean');
    });

    test('branches for non-existent repo returns error', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: repoData } = await api.listGitHubRepos();

      if (repoData.tokenConfigured) {
        const { status } = await api.listGitHubBranches('test-owner', `non-existent-repo-${Date.now()}`);
        // GitHub API returns 404 for non-existent repos, which the API should forward as an error
        expect(status).toBeGreaterThanOrEqual(400);
      }
    });
  });
});
