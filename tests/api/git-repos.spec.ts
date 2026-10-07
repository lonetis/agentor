import { test, expect, request as playwrightRequest } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createTestUser, deleteTestUser, signedInContext, type CreatedUser } from '../helpers/test-users';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// The provider-agnostic repo endpoints (/api/git-providers/:providerId/*),
// exercised without real provider credentials: auth, unknown providers, input
// validation, and the no-token / rejected-token contract. GitLab round trips
// against a mock instance live in gitlab.spec.ts.
test.describe.serial('Git repo endpoints', () => {
  let user: CreatedUser;
  let api: ApiClient;
  let ctx: Awaited<ReturnType<typeof signedInContext>>;

  test.beforeAll(async () => {
    user = await createTestUser('Git Repos');
    ctx = await signedInContext(user.email, user.password);
    api = new ApiClient(ctx);
  });

  test.afterAll(async () => {
    await ctx?.dispose();
    if (user) await deleteTestUser(user.id);
  });

  test('require auth', async () => {
    const anon = await playwrightRequest.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { Origin: BASE_URL },
      storageState: { cookies: [], origins: [] },
    });
    try {
      expect((await anon.get('/api/git-providers/github/repos')).status()).toBe(401);
      expect((await anon.get('/api/git-providers/github/branches?repo=a/b')).status()).toBe(401);
      expect((await anon.post('/api/git-providers/github/repos', { data: { owner: 'a', name: 'b' } })).status()).toBe(401);
    } finally {
      await anon.dispose();
    }
  });

  test('unknown provider → 404 on every route', async () => {
    expect((await api.listGitRepos('no-such-provider')).status).toBe(404);
    expect((await api.listGitBranches('no-such-provider', 'a/b')).status).toBe(404);
    expect((await api.createGitRepo('no-such-provider', { owner: 'a', name: 'b' })).status).toBe(404);
  });

  for (const providerId of ['github', 'gitlab']) {
    test(`${providerId}: no token → empty list with tokenConfigured false`, async () => {
      const { status, body } = await api.listGitRepos(providerId);
      expect(status).toBe(200);
      expect(body).toEqual({ repos: [], tokenConfigured: false, username: '', namespaces: [] });
    });

    test(`${providerId}: branches and create need a token (400)`, async () => {
      const branches = await api.listGitBranches(providerId, 'owner/repo');
      expect(branches.status).toBe(400);
      expect(branches.body.statusMessage).toContain('token not configured');
      const create = await api.createGitRepo(providerId, { owner: 'owner', name: 'repo' });
      expect(create.status).toBe(400);
      expect(create.body.statusMessage).toContain('token not configured');
    });
  }

  test('a rejected token is reported as tokenConfigured with an error, not as "no token"', async () => {
    test.setTimeout(60_000);
    const put = await api.putAccountEnvVars({ envVars: [{ key: 'GITHUB_TOKEN', value: 'ghp_bogus_invalid_token_for_test' }] });
    expect(put.status).toBe(200);
    try {
      const { status, body } = await api.listGitRepos('github');
      expect(status).toBe(200);
      expect(body.tokenConfigured).toBe(true);
      // GitHub 401 (or unreachable from the runner) — surfaced either way.
      expect(typeof body.error).toBe('string');
      expect(body.error).toContain('GitHub');
      expect(body.repos).toEqual([]);
    } finally {
      await api.putAccountEnvVars({ envVars: [] });
    }
  });
});
