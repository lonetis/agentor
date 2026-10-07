import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createTestUser, deleteTestUser, signedInContext, type CreatedUser } from '../helpers/test-users';

// GitLab support against a self-managed instance: the dockerized stack runs a
// GitLab mock (tests/docker/gitlab-mock) configured as
// GITLAB_INSTANCES=mock=http://gitlab-mock:8080 → provider `gitlab-mock`.
// The mock caps pages at 2 items and sends `Link` headers to a host that does
// not exist, so listing everything proves `X-Next-Page` pagination.
const MOCK = 'gitlab-mock';
const MOCK_TOKEN = 'glpat-agentor-mock-token';

interface Repo { fullName: string; private: boolean; defaultBranch: string }

async function userWithEnv(name: string, envVars: { key: string; value: string }[]) {
  const user = await createTestUser(name);
  const ctx = await signedInContext(user.email, user.password);
  const api = new ApiClient(ctx);
  expect((await api.putAccountEnvVars({ envVars })).status).toBe(200);
  return { user, ctx, api };
}

test.describe('GitLab (self-managed instance)', () => {
  let mockConfigured = false;
  let user: CreatedUser;
  let ctx: Awaited<ReturnType<typeof signedInContext>>;
  let api: ApiClient;

  test.beforeAll(async ({ request }) => {
    const { body } = await new ApiClient(request).listGitProviders();
    mockConfigured = body.some((p: { id: string }) => p.id === MOCK);
    if (!mockConfigured) return;
    ({ user, ctx, api } = await userWithEnv('GitLab API', [{ key: 'GITLAB_MOCK_TOKEN', value: MOCK_TOKEN }]));
  });

  test.afterAll(async () => {
    await ctx?.dispose();
    if (user) await deleteTestUser(user.id);
  });

  test.beforeEach(() => {
    test.skip(!mockConfigured, 'needs GITLAB_INSTANCES=mock=… (dockerized test stack)');
  });

  test('gitlab.com is built in and GITLAB_INSTANCES adds the self-managed instance', async () => {
    const { status, body } = await api.listGitProviders();
    expect(status).toBe(200);
    const ids = body.map((p: { id: string }) => p.id);
    expect(ids.slice(0, 2)).toEqual(['github', 'gitlab']);
    expect(body.find((p: { id: string }) => p.id === 'gitlab')).toEqual({
      id: 'gitlab',
      type: 'gitlab',
      displayName: 'GitLab',
      url: 'https://gitlab.com',
      placeholder: 'https://gitlab.com/group/project',
      tokenEnvVar: 'GITLAB_TOKEN',
      tokenConfigured: false,
    });
    expect(body.find((p: { id: string }) => p.id === MOCK)).toEqual({
      id: MOCK,
      type: 'gitlab',
      displayName: 'GitLab (mock)',
      url: 'http://gitlab-mock:8080',
      placeholder: 'http://gitlab-mock:8080/group/project',
      tokenEnvVar: 'GITLAB_MOCK_TOKEN',
      tokenConfigured: true,
    });
  });

  test('lists projects across pages with nested paths, visibility and default branches', async () => {
    const { status, body } = await api.listGitRepos(MOCK);
    expect(status).toBe(200);
    expect(body.tokenConfigured).toBe(true);
    expect(body.error).toBeUndefined();
    expect(body.username).toBe('mock-user');
    expect(body.namespaces).toEqual(['group', 'group/sub']);

    const repos = body.repos as Repo[];
    // Seeded projects — page 2 only reachable through X-Next-Page.
    expect(repos).toContainEqual({ fullName: 'group/sub/project', private: true, defaultBranch: 'main' });
    expect(repos).toContainEqual({ fullName: 'group/public-proj', private: false, defaultBranch: 'develop' });
    // `internal` visibility is not public.
    expect(repos).toContainEqual({ fullName: 'mock-user/personal', private: true, defaultBranch: 'main' });
    const names = repos.map((r) => r.fullName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  test('lists the branches of a nested project', async () => {
    const { status, body } = await api.listGitBranches(MOCK, 'group/sub/project');
    expect(status).toBe(200);
    expect(body).toEqual({ branches: [{ name: 'main' }, { name: 'feature-x' }], defaultBranch: 'main' });
    // A `.git` suffix (copied clone URL path) is accepted.
    expect((await api.listGitBranches(MOCK, 'group/sub/project.git')).body.defaultBranch).toBe('main');
  });

  test('branch lookup errors', async () => {
    expect((await api.listGitBranches(MOCK)).status).toBe(400);
    const single = await api.listGitBranches(MOCK, 'project');
    expect(single.status).toBe(400);
    expect(single.body.statusMessage).toContain('group/project');
    const missing = await api.listGitBranches(MOCK, `group/missing-${Date.now()}`);
    expect(missing.status).toBe(404);
    expect(missing.body.statusMessage).toContain('404 Project Not Found');
  });

  test('creates projects in a subgroup and in the personal namespace', async () => {
    const stamp = Date.now();
    const inGroup = await api.createGitRepo(MOCK, { owner: 'group/sub', name: `made-${stamp}`, private: true });
    expect(inGroup.status).toBe(200);
    // An empty project has no default branch yet.
    expect(inGroup.body.repo).toEqual({ fullName: `group/sub/made-${stamp}`, private: true, defaultBranch: '' });

    const personal = await api.createGitRepo(MOCK, { owner: 'mock-user', name: `mine-${stamp}` });
    expect(personal.status).toBe(200);
    expect(personal.body.repo).toEqual({ fullName: `mock-user/mine-${stamp}`, private: false, defaultBranch: '' });

    // The cached list is invalidated by a create.
    const names = ((await api.listGitRepos(MOCK)).body.repos as Repo[]).map((r) => r.fullName);
    expect(names).toContain(`group/sub/made-${stamp}`);
    expect(names).toContain(`mock-user/mine-${stamp}`);
  });

  test('create errors from the instance are passed through', async () => {
    const taken = await api.createGitRepo(MOCK, { owner: 'group/sub', name: 'project' });
    expect(taken.status).toBe(400);
    expect(taken.body.statusMessage).toContain('has already been taken');

    const unknownNs = await api.createGitRepo(MOCK, { owner: `nope-${Date.now()}`, name: 'x' });
    expect(unknownNs.status).toBe(404);

    for (const data of [{ name: 'repo' }, { owner: 'group' }, { owner: '', name: 'repo' }, { owner: 'group', name: '  ' }, { owner: 1, name: 'repo' }]) {
      const { status } = await api.createGitRepo(MOCK, data);
      expect(status, JSON.stringify(data)).toBe(400);
    }
  });

  test('a token the instance rejects is surfaced as an error (repos 200, branches 502)', async () => {
    const bad = await userWithEnv('GitLab Bad Token', [{ key: 'GITLAB_MOCK_TOKEN', value: 'glpat-wrong' }]);
    try {
      const { status, body } = await bad.api.listGitRepos(MOCK);
      expect(status).toBe(200);
      expect(body.tokenConfigured).toBe(true);
      expect(body.repos).toEqual([]);
      expect(body.error).toBe('GitLab (mock) API error (401): 401 Unauthorized');

      const branches = await bad.api.listGitBranches(MOCK, 'group/sub/project');
      expect(branches.status).toBe(502);
    } finally {
      await bad.ctx.dispose();
      await deleteTestUser(bad.user.id);
    }
  });

  test('tokens are per provider: a gitlab.com token does not unlock the instance', async () => {
    const other = await userWithEnv('GitLab Other Token', [{ key: 'GITLAB_TOKEN', value: MOCK_TOKEN }]);
    try {
      const providers = (await other.api.listGitProviders()).body as { id: string; tokenConfigured: boolean }[];
      expect(providers.find((p) => p.id === 'gitlab')?.tokenConfigured).toBe(true);
      expect(providers.find((p) => p.id === MOCK)?.tokenConfigured).toBe(false);
      expect((await other.api.listGitRepos(MOCK)).body.tokenConfigured).toBe(false);
    } finally {
      await other.ctx.dispose();
      await deleteTestUser(other.user.id);
    }
  });
});
