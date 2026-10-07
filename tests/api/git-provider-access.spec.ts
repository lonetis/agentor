import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createWorker, cleanupWorker, waitForWorkerRunning } from '../helpers/worker-lifecycle';
import { createTestUser, deleteTestUser, signedInContext, type CreatedUser } from '../helpers/test-users';

// An environment's `enabledGitProviderIds` decides which git providers' owner
// credentials its workers get. For every other provider: no token env var
// (account- or environment-defined, incl. the CLIs' own variables), no git /
// gh / glab auth, no credentials left by an earlier boot — public
// repositories still clone. One worker walks through no provider → only the
// stack's GitLab mock (`gitlab-mock`) → every provider, rebuilding in between.
const MOCK = 'gitlab-mock';
const MOCK_TOKEN = 'glpat-agentor-mock-token';
// Every token that belongs to GitHub, gitlab.com or a CLI variable carries this
// marker, so one grep over the container's environment proves none got in.
const WITHHELD = 'agentor-withheld';

test.describe.serial('Git provider access selected per environment', () => {
  let mockConfigured = false;
  let user: CreatedUser;
  let ctx: Awaited<ReturnType<typeof signedInContext>>;
  let api: ApiClient;
  let environmentId = '';
  let workerId = '';

  async function exec(command: string) {
    const { status, body } = await api.execCommand(workerId, { command, cwd: '/tmp' });
    expect(status).toBe(200);
    return body as { exitCode: number; stdout: string; stderr: string };
  }

  /** Polls a command's trimmed stdout — tolerating a container that is still
   * (re)starting — until it equals `expected`. */
  async function pollStdout(command: string, expected: string) {
    await expect.poll(async () => {
      const { status, body } = await api.execCommand(workerId, { command, cwd: '/tmp' });
      return status === 200 ? String(body.stdout).trim() : `HTTP ${status}`;
    }, { timeout: 120_000, intervals: [2_000] }).toBe(expected);
  }

  async function selectProvidersAndRebuild(enabledGitProviderIds: string[] | null) {
    expect((await api.updateEnvironment(environmentId, { enabledGitProviderIds })).status).toBe(200);
    expect((await api.rebuildContainer(workerId)).status).toBe(200);
    await waitForWorkerRunning(ctx, workerId, 90_000);
  }

  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    const { body: providers } = await new ApiClient(request).listGitProviders();
    mockConfigured = providers.some((p: { id: string }) => p.id === MOCK);

    user = await createTestUser('Git Access');
    ctx = await signedInContext(user.email, user.password);
    api = new ApiClient(ctx);
    expect((await api.putAccountEnvVars({
      envVars: [
        { key: 'GITHUB_TOKEN', value: `ghp_${WITHHELD}_github` },
        { key: 'GH_TOKEN', value: `gho_${WITHHELD}_gh` },
        { key: 'GITLAB_TOKEN', value: `glpat-${WITHHELD}-gitlab` },
        { key: 'GITLAB_ACCESS_TOKEN', value: `glpat-${WITHHELD}-glab` },
        ...(mockConfigured ? [{ key: 'GITLAB_MOCK_TOKEN', value: MOCK_TOKEN }] : []),
        { key: 'ANTHROPIC_API_KEY', value: 'sk-ant-kept' },
        { key: 'KEPT_CUSTOM', value: 'kept-value' },
      ],
    })).status).toBe(200);

    const env = await api.createEnvironment({
      name: `NoGit-${Date.now()}`,
      enabledGitProviderIds: [],
      dockerEnabled: false,
      envVars: `GITLAB_TOKEN=glpat-${WITHHELD}-env\nENV_KEPT=env-value`,
    });
    expect(env.status).toBe(201);
    environmentId = env.body.id;

    workerId = (await createWorker(ctx, {
      environmentId,
      repos: mockConfigured
        ? [{ provider: MOCK, url: 'group/public-proj' }, { provider: MOCK, url: 'group/sub/project' }]
        : [],
    })).id;
    // The entrypoint configures git (Phase 4) and clones (Phase 5) after the
    // container already reports "running".
    await pollStdout(
      `test -n "$(git config --global user.email)" ${mockConfigured ? '&& test -d /workspace/public-proj/.git' : ''} && echo ready`,
      'ready',
    );
  });

  test.afterAll(async () => {
    if (workerId) await cleanupWorker(ctx, workerId);
    if (environmentId) await api.deleteEnvironment(environmentId);
    await ctx?.dispose();
    if (user) await deleteTestUser(user.id);
  });

  test('no provider enabled: no git token reaches the container — neither from the account nor from the environment', async () => {
    const { stdout } = await exec(
      'echo "W=$(grep -caF ' + WITHHELD + ' /proc/1/environ)' +
      ' V=$(env | grep -cE \'^(GITHUB_TOKEN|GH_TOKEN|GITLAB_TOKEN|GITLAB_ACCESS_TOKEN|GITLAB_MOCK_TOKEN)=\')' +
      ' A=$ANTHROPIC_API_KEY C=$KEPT_CUSTOM"',
    );
    // Non-git account env vars are still passed.
    expect(stdout.trim()).toBe('W=0 V=0 A=sk-ant-kept C=kept-value');
  });

  test("no provider enabled: ENVIRONMENT says so and the environment's own git token is dropped", async () => {
    const { stdout } = await exec(
      `jq -r '"\\(.enabledGitProviderIds | tojson) \\(.envVars)"' <<< "$ENVIRONMENT";` +
      ' tmux show-environment -g ENV_KEPT; tmux show-environment -g GITLAB_TOKEN 2>/dev/null || echo "no GITLAB_TOKEN"',
    );
    expect(stdout.trim().split('\n')).toEqual(['[] ENV_KEPT=env-value', 'ENV_KEPT=env-value', 'no GITLAB_TOKEN']);
  });

  test('no provider enabled: git, gh and glab are not authenticated', async () => {
    const helpers = await exec("git config --global --get-regexp '^credential\\.' | wc -l");
    expect(helpers.stdout.trim()).toBe('0');
    const gh = await exec('gh auth status');
    expect(gh.exitCode).not.toBe(0);
    const glab = await exec(
      'command -v glab > /dev/null && echo "T=[$(glab config get token --host gitlab-mock 2>/dev/null)$(glab config get token --host gitlab.com 2>/dev/null)]"',
    );
    expect(glab.stdout.trim()).toBe('T=[]');
  });

  test('no provider enabled: public repositories still clone; private ones stay out of reach', async () => {
    test.skip(!mockConfigured, 'needs GITLAB_INSTANCES=mock=… (dockerized test stack)');
    const { stdout } = await exec(
      'echo "P=$(git -C /workspace/public-proj branch --show-current) S=$(test -d /workspace/project && echo cloned || echo missing)"',
    );
    expect(stdout.trim()).toBe('P=develop S=missing');
    const lsRemote = await exec('GIT_TERMINAL_PROMPT=0 git ls-remote http://gitlab-mock:8080/group/sub/project.git');
    expect(lsRemote.exitCode).not.toBe(0);
  });

  test('credentials an earlier boot left behind for a provider that is not enabled are scrubbed on start', async () => {
    test.setTimeout(180_000);
    const plant = await exec(
      'mkdir -p ~/.config/gh ~/.config/glab-cli' +
      ' && echo "github.com: {oauth_token: planted}" > ~/.config/gh/hosts.yml' +
      ' && echo "hosts: {gitlab.com: {token: planted}}" > ~/.config/glab-cli/config.yml' +
      " && git config --global credential.https://github.com.helper '!echo password=planted'" +
      ' && echo planted',
    );
    expect(plant.stdout.trim()).toBe('planted');

    // A restart keeps the container's filesystem, like a restored rootfs.
    expect((await api.restartContainer(workerId)).status).toBe(200);
    await waitForWorkerRunning(ctx, workerId, 90_000);
    await pollStdout(
      'echo "$(ls ~/.config/gh/hosts.yml ~/.config/glab-cli/config.yml 2>/dev/null | wc -l) $(git config --global --get-regexp \'^credential\\.\' | wc -l)"',
      '0 0',
    );
  });

  test('only the GitLab instance enabled: its credentials alone reach the worker', async () => {
    test.skip(!mockConfigured, 'needs GITLAB_INSTANCES=mock=… (dockerized test stack)');
    test.setTimeout(240_000);
    await selectProvidersAndRebuild([MOCK]);

    // GitHub's and gitlab.com's tokens stay out, and so do the CLI variables
    // (GH_TOKEN, GITLAB_ACCESS_TOKEN) — glab would use the latter for any host.
    await pollStdout(
      'echo "W=$(grep -caF ' + WITHHELD + ' /proc/1/environ) M=$GITLAB_MOCK_TOKEN";' +
      " git config --global --get-regexp '^credential\\.' | cut -d' ' -f1; jq -r .envVars <<< \"$ENVIRONMENT\"",
      [`W=0 M=${MOCK_TOKEN}`, 'credential.http://gitlab-mock:8080.helper', 'ENV_KEPT=env-value'].join('\n'),
    );
    const gh = await exec('gh auth status');
    expect(gh.exitCode).not.toBe(0);
    const glab = await exec('echo "M=$(glab config get token --host gitlab-mock) C=[$(glab config get token --host gitlab.com 2>/dev/null)]"');
    expect(glab.stdout.trim()).toBe(`M=${MOCK_TOKEN} C=[]`);
    // The private project was skipped before; now it clones with the token.
    await pollStdout('git -C /workspace/project branch --show-current', 'main');
  });

  test('every provider enabled again: all credentials are back after a rebuild', async () => {
    test.setTimeout(240_000);
    await selectProvidersAndRebuild(null);

    await pollStdout(
      'echo "G=$GITHUB_TOKEN H=$(git config --global --get credential.https://github.com.helper)"; jq -r .envVars <<< "$ENVIRONMENT"',
      [`G=ghp_${WITHHELD}_github H=!gh auth git-credential`, `GITLAB_TOKEN=glpat-${WITHHELD}-env`, 'ENV_KEPT=env-value'].join('\n'),
    );
  });
});
