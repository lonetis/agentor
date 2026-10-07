import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';
import { createTestUser, deleteTestUser, signedInContext, type CreatedUser } from '../helpers/test-users';

// A worker cloning from a self-managed GitLab (the stack's gitlab-mock,
// provider `gitlab-mock`) with the owner's GITLAB_MOCK_TOKEN: path → clone URL
// resolution, per-host git credentials (also for push), glab, and the
// restricted-network allowlist.
const MOCK = 'gitlab-mock';
const MOCK_TOKEN = 'glpat-agentor-mock-token';

test.describe.serial('GitLab in workers', () => {
  let mockConfigured = false;
  let user: CreatedUser;
  let ctx: Awaited<ReturnType<typeof signedInContext>>;
  let api: ApiClient;
  let environmentId = '';
  let workerId = '';

  async function exec(command: string, cwd?: string) {
    const { status, body } = await api.execCommand(workerId, { command, ...(cwd ? { cwd } : {}) });
    expect(status).toBe(200);
    return body as { exitCode: number; stdout: string; stderr: string };
  }

  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    const { body } = await new ApiClient(request).listGitProviders();
    mockConfigured = body.some((p: { id: string }) => p.id === MOCK);
    if (!mockConfigured) return;

    user = await createTestUser('GitLab Worker');
    ctx = await signedInContext(user.email, user.password);
    api = new ApiClient(ctx);
    expect((await api.putAccountEnvVars({ envVars: [{ key: 'GITLAB_MOCK_TOKEN', value: MOCK_TOKEN }] })).status).toBe(200);

    // A restricted network mode, so the git provider hosts must be allowlisted.
    const env = await api.createEnvironment({ name: `GitLab-${Date.now()}`, networkMode: 'custom', allowedDomains: ['example.com'] });
    expect(env.status).toBe(201);
    environmentId = env.body.id;

    workerId = (await createWorker(ctx, {
      environmentId,
      repos: [
        { provider: MOCK, url: 'group/sub/project', branch: 'feature-x' },
        { provider: MOCK, url: 'http://gitlab-mock:8080/group/public-proj.git' },
      ],
    })).id;

    // Cloning runs in the entrypoint after the container is already "running".
    await expect.poll(async () => (await exec(
      'test -d /workspace/project/.git && test -d /workspace/public-proj/.git && echo cloned',
    )).stdout.trim(), { timeout: 120_000, intervals: [2_000] }).toBe('cloned');
  });

  test.afterAll(async () => {
    if (workerId) await cleanupWorker(ctx, workerId);
    if (environmentId) await api.deleteEnvironment(environmentId);
    await ctx?.dispose();
    if (user) await deleteTestUser(user.id);
  });

  test.beforeEach(() => {
    test.skip(!mockConfigured, 'needs GITLAB_INSTANCES=mock=… (dockerized test stack)');
  });

  test('clones a project path from the instance on the requested branch', async () => {
    const { stdout } = await exec('echo "B=$(git branch --show-current) F=$(cat feature-x.txt)"', '/workspace/project');
    expect(stdout.trim()).toBe('B=feature-x F=group/sub/project feature-x');
  });

  test('clones a full clone URL on its default branch', async () => {
    const { stdout } = await exec('git branch --show-current', '/workspace/public-proj');
    expect(stdout.trim()).toBe('develop');
  });

  test('git credentials read the token from the environment — it is never written to git config', async () => {
    const { stdout } = await exec(
      'echo "H=$(git config --global --get credential.http://gitlab-mock:8080.helper | grep -cF \'$GITLAB_MOCK_TOKEN\') T=$(grep -cF "$GITLAB_MOCK_TOKEN" ~/.gitconfig)"',
    );
    expect(stdout.trim()).toBe('H=1 T=0');
  });

  test('pushes over HTTPS with the same credentials', async () => {
    const branch = `pushed-${Date.now()}`;
    const { exitCode, stderr } = await exec(
      `git checkout -q -b ${branch} && echo x > pushed.txt && git add pushed.txt && git commit -qm push && git push -q origin ${branch}`,
      '/workspace/project',
    );
    expect(exitCode, stderr).toBe(0);
    const { stdout } = await exec(`git ls-remote origin refs/heads/${branch} | wc -l`, '/workspace/project');
    expect(stdout.trim()).toBe('1');
  });

  test('glab is authenticated against the instance, inside a clone and by --hostname', async () => {
    const inRepo = await exec('glab repo view -F json | jq -r .path_with_namespace', '/workspace/project');
    expect(inRepo.stdout.trim()).toBe('group/sub/project');
    const byHost = await exec('glab api user --hostname gitlab-mock | jq -r .username', '/tmp');
    expect(byHost.stdout.trim()).toBe('mock-user');
  });

  test('the WORKER payload carries the provider registry', async () => {
    const { stdout } = await exec(
      `jq -r '.gitProviders[] | select(.id == "${MOCK}") | "\\(.type) \\(.url) \\(.tokenEnvVar)"' <<< "$WORKER"`,
    );
    expect(stdout.trim()).toBe('gitlab http://gitlab-mock:8080 GITLAB_MOCK_TOKEN');
  });

  test('restricted network modes allow every git provider host', async () => {
    const { stdout } = await exec(`jq -r '.allowedDomains[]' <<< "$ENVIRONMENT"`);
    const domains = stdout.trim().split('\n');
    expect(domains).toEqual(expect.arrayContaining(['example.com', 'github.com', 'gitlab.com', '*.gitlab.com', 'gitlab-mock']));
  });
});
