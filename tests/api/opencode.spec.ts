import { test, expect, type APIRequestContext } from '@playwright/test';
import { gunzipSync } from 'node:zlib';
import { ApiClient } from '../helpers/api-client';
import { createWorker, cleanupWorker, waitForWorkerRunning } from '../helpers/worker-lifecycle';
import { createTestUser, deleteTestUser, signedInContext, type CreatedUser } from '../helpers/test-users';

// Real provider responses belong in opt-in prompting tests. These lifecycle
// tests use disposable users and inert keys, never the operator's account.
test.describe.serial('OpenCode with Zen', () => {
  let owner: CreatedUser;
  let other: CreatedUser;
  let context: APIRequestContext;
  let otherContext: APIRequestContext;
  let api: ApiClient;
  let otherApi: ApiClient;
  let worker: string;
  let second: string;
  let isolated: string;
  let envId: string;
  let imported: string;
  let restricted: string;
  let restrictedEnv: string;

  async function exec(id: string, command: string, client = api) {
    const result = await client.execCommand(id, { command });
    expect(result.status).toBe(200);
    expect(result.body.exitCode, result.body.stderr).toBe(0);
    return result.body.stdout as string;
  }

  async function ready(id: string, client = api) {
    await expect.poll(async () => {
      const result = await client.execCommand(id, { command: "grep -q '^READY|' /tmp/worker-events" });
      return result.body.exitCode;
    }, { timeout: 90_000 }).toBe(0);
  }

  test.beforeAll(async () => {
    owner = await createTestUser('OpenCode Owner');
    other = await createTestUser('OpenCode Isolated');
    context = await signedInContext(owner.email, owner.password);
    otherContext = await signedInContext(other.email, other.password);
    api = new ApiClient(context);
    otherApi = new ApiClient(otherContext);
    const env = await api.createEnvironment({ name: 'Zen tests', dockerEnabled: false });
    expect(env.status).toBe(201);
    envId = env.body.id;
    worker = (await createWorker(context, { environmentId: envId })).id;
    second = (await createWorker(context, { environmentId: envId })).id;
    isolated = (await createWorker(otherContext)).id;
    await Promise.all([ready(worker), ready(second), ready(isolated, otherApi)]);
  });

  test.afterAll(async () => {
    for (const id of [worker, second, imported, restricted]) {
      if (id && context) await cleanupWorker(context, id);
    }
    if (isolated && otherContext) await cleanupWorker(otherContext, isolated);
    if (envId && api) await api.deleteEnvironment(envId);
    if (restrictedEnv && api) await api.deleteEnvironment(restrictedEnv);
    await context?.dispose();
    await otherContext?.dispose();
    if (owner) await deleteTestUser(owner.id);
    if (other) await deleteTestUser(other.id);
  });

  test('loads the Zen catalog, instructions, shared skills and local MCPs', async () => {
    expect((await exec(worker, 'opencode --version')).trim()).toMatch(/^opencode v2\./);
    const config = JSON.parse(await exec(worker, 'cat ~/.config/opencode/opencode.json'));
    expect(config.model).toBeUndefined();
    expect(config.providers.zen.name).toBe('OpenCode Console (Zen)');
    expect(config.providers.zen.env).toEqual(['OPENCODE_ZEN_API_KEY']);
    expect(config.providers).not.toHaveProperty('opencode-go');
    expect(config.mcp.servers.playwright.command).toContain('@playwright/mcp@latest');
    expect(config.mcp.servers['chrome-devtools'].command).toContain('chrome-devtools-mcp@latest');
    const nativeModels = async () => JSON.parse(await exec(worker, 'opencode api model.list | jq \'{data: [.data[] | select(.providerID == "zen" and (.id == "gpt-6.1-sol" or .id == "claude-sonnet-4-6"))]}\'' )).data;
    await expect.poll(async () => (await nativeModels()).some((m: any) => m.providerID === 'zen' && m.id === 'gpt-6.1-sol'), { timeout: 60_000 }).toBe(true);
    const models = await nativeModels();
    const defaultModel = JSON.parse(await exec(worker, 'opencode api model.default')).data;
    expect(defaultModel).toMatchObject({ providerID: 'zen', status: 'active', capabilities: { tools: true } });
    const catalog = JSON.parse(await exec(worker, 'cat ~/agents/opencode/zen-provider.json'));
    expect(catalog.models[defaultModel.id]).toBeDefined();
    const sol = models.find((m: any) => m.providerID === 'zen' && m.id === 'gpt-6.1-sol');
    expect(sol.variants.map((v: any) => v.id)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(sol.settings.reasoningEffort).toBeUndefined();
    expect(models.find((m: any) => m.providerID === 'zen' && m.id === 'claude-sonnet-4-6').package).toBe('@opencode/ai/providers/anthropic');
    expect(await exec(worker, 'cat ~/.config/opencode/AGENTS.md')).toContain('Agentor');
    await expect.poll(async () => await exec(worker, 'opencode api skill.list | jq -r \'.data[].name\'')).toContain('agentor-tmux');
    await expect.poll(async () => await exec(worker, 'opencode api mcp.list'), { timeout: 90_000 }).toMatch(/playwright[\s\S]*connected/i);
  });

  test('shares native OpenCode 2 credentials across owner workers and isolates other users', async () => {
    const methods = JSON.parse(await exec(worker, 'opencode api integration.list | jq \'{data: [.data[] | select(.id == "zen")]}\'')).data.find((i: any) => i.id === 'zen').methods;
    expect(methods).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'oauth', label: 'OpenCode Console account' }),
      expect.objectContaining({ type: 'key', label: 'API key (service account)' }),
    ]));
    await exec(worker, `opencode api POST /api/integration/zen/connect/key --data '{"key":"zen-test-credential"}'`);
    await expect.poll(async () => (await api.listAccountAgentCredentials()).body.find((c: any) => c.agentId === 'opencode').configured).toBe(true);
    const creds = JSON.parse(await exec(second, 'cat ~/.local/share/opencode/auth.json'));
    expect(creds.credentials.find((c: any) => c.integrationID === 'zen').value.key).toBe('zen-test-credential');
    for (const id of [worker, second]) {
      await expect.poll(async () => JSON.parse(await exec(id, 'opencode api integration.list')).data
        .some((item: any) => item.id === 'anthropic'), { timeout: 60_000 }).toBe(true);
    }
    await Promise.all([
      exec(worker, `opencode api POST /api/integration/openrouter/connect/key --data '{"key":"router-test-credential"}'`),
      exec(second, `opencode api POST /api/integration/anthropic/connect/key --data '{"key":"anthropic-test-credential"}'`),
    ]);
    const providerIDs = ['anthropic', 'openrouter', 'zen'];
    await expect.poll(async () => {
      const saved = JSON.parse(await exec(worker, 'cat ~/.local/share/opencode/auth.json'));
      return saved.credentials.map((item: any) => item.integrationID).sort();
    }).toEqual(providerIDs);
    for (const id of [worker, second]) {
      await expect.poll(async () => JSON.parse(await exec(id, 'opencode api credential.list')).data
        .map((item: any) => item.integrationID).sort()).toEqual(providerIDs);
    }
    const theirs = await otherApi.listAccountAgentCredentials();
    expect(theirs.body.find((c: any) => c.agentId === 'opencode').configured).toBe(false);
    expect(JSON.parse(await exec(isolated, 'cat ~/.local/share/opencode/auth.json', otherApi))).toEqual({});
    const usage = await api.refreshUsage();
    expect(usage.body.agents.find((a: any) => a.agentId === 'zen')).toMatchObject({
      displayName: 'OpenCode', authType: 'api-key', connected: true, usageAvailable: false, windows: [],
    });
    const otherUsage = await otherApi.refreshUsage();
    expect(otherUsage.body.agents.find((a: any) => a.agentId === 'zen')).toMatchObject({ authType: 'none', connected: false });
    const denied = await otherApi.execCommand(worker, { command: 'true' });
    expect([403, 404]).toContain(denied.status);
  });

  test('reports shared Console OAuth ahead of the account API key without exposing tokens', async () => {
    await exec(worker, 'opencode service stop');
    expect((await api.putAccountEnvVars({ envVars: [{ key: 'OPENCODE_ZEN_API_KEY', value: 'env-test-key' }] })).status).toBe(200);
    await exec(worker, `printf '%s' '{"zen":{"type":"oauth","access":"oauth-test-access","refresh":"oauth-test-refresh","expires":4102444800000,"accountId":"org-test"}}' > ~/.local/share/opencode/auth.json`);
    expect(JSON.parse(await exec(second, 'cat ~/.local/share/opencode/auth.json')).zen.type).toBe('oauth');
    const own = await api.listAccountAgentCredentials();
    expect(own.body.find((c: { agentId: string }) => c.agentId === 'opencode')).toMatchObject({ configured: true, zenAuthType: 'oauth' });
    expect(JSON.stringify(own.body)).not.toMatch(/oauth-test-access|oauth-test-refresh|env-test-key/);
    expect((await api.refreshUsage()).body.agents.find((a: { agentId: string }) => a.agentId === 'zen')).toMatchObject({ authType: 'oauth', connected: true, usageAvailable: false });
    expect((await otherApi.listAccountAgentCredentials()).body.find((c: { agentId: string }) => c.agentId === 'opencode').zenAuthType).toBe('none');
    expect((await api.resetAccountAgentCredential('opencode')).status).toBe(200);
    expect(JSON.parse(await exec(second, 'cat ~/.local/share/opencode/auth.json'))).toMatchObject({ credentials: [], sync: { resetID: expect.any(String) } });
    expect((await api.listAccountAgentCredentials()).body.find((c: { agentId: string }) => c.agentId === 'opencode')).toMatchObject({ configured: false, zenAuthType: 'api-key' });
    expect((await api.refreshUsage()).body.agents.find((a: { agentId: string }) => a.agentId === 'zen')).toMatchObject({ authType: 'none', connected: false });
    expect((await api.putAccountEnvVars({ envVars: [] })).status).toBe(200);
  });

  test('rejects malformed credential state and resets all saved providers', async () => {
    for (const content of ['{  }', 'not-json', '{"zen":{"type":"api","key":""}}']) {
      await exec(worker, `printf '%s' '${content}' > ~/.local/share/opencode/auth.json`);
      const list = await api.listAccountAgentCredentials();
      expect(list.body.find((c: { agentId: string }) => c.agentId === 'opencode').configured).toBe(false);
      expect((await api.refreshUsage()).body.agents.find((a: { agentId: string }) => a.agentId === 'zen')).toMatchObject({ authType: 'none', connected: false });
    }
    await exec(worker, `printf '%s' '{"zen":{"type":"api","key":"zen-test-credential"},"other":{"type":"api","key":"other-test-credential"}}' > ~/.local/share/opencode/auth.json`);
    expect((await api.resetAccountAgentCredential('opencode')).status).toBe(200);
    expect(JSON.parse(await exec(second, 'cat ~/.local/share/opencode/auth.json'))).toMatchObject({ credentials: [], sync: { resetID: expect.any(String) } });
  });

  test('Reset waits for an in-progress Console refresh across the worker bind mount', async () => {
    await exec(worker, `cat > /tmp/console-refresh-body.sh <<'SCRIPT'
touch /tmp/console-refresh-ready
sleep 1
printf '%s' '{"zen":{"type":"oauth","access":"refreshed-test-token","refresh":"refresh-test-token","expires":4102444800000}}' > "$HOME/.local/share/opencode/auth.json"
touch /tmp/console-refresh-done
SCRIPT
tmux new-window -d -n console-refresh-test 'flock -x "$HOME/.local/share/opencode/auth.json" sh /tmp/console-refresh-body.sh'`);
    await expect.poll(async () => (await api.execCommand(worker, { command: 'test -f /tmp/console-refresh-ready' })).body.exitCode).toBe(0);
    expect((await api.resetAccountAgentCredential('opencode')).status).toBe(200);
    await exec(worker, 'test -f /tmp/console-refresh-done');
    expect(JSON.parse(await exec(second, 'cat ~/.local/share/opencode/auth.json'))).toMatchObject({ credentials: [], sync: { resetID: expect.any(String) } });
  });

  test('preserves per-worker settings, data and state across rebuild and archive', async () => {
    await exec(worker, `jq '.providers.zen.name = "My Zen" | .model = "zen/gpt-5-nano"' ~/.config/opencode/opencode.json > /tmp/zen-settings.json && cp /tmp/zen-settings.json ~/.config/opencode/opencode.json && touch ~/.local/share/opencode/session-marker ~/.local/state/opencode/ui-marker`);
    expect(await exec(second, 'test ! -f ~/.local/share/opencode/session-marker && echo isolated')).toContain('isolated');
    const rebuild = await api.rebuildContainer(worker);
    expect(rebuild.status).toBe(200);
    await waitForWorkerRunning(context, worker);
    await ready(worker);
    expect(await exec(worker, `jq -r '.providers.zen.name' ~/.config/opencode/opencode.json`)).toContain('My Zen');
    expect((await exec(worker, `jq -r '.model' ~/.config/opencode/opencode.json`)).trim()).toBe('zen/gpt-5-nano');
    await exec(worker, 'test -f ~/.local/share/opencode/session-marker && test -f ~/.local/state/opencode/ui-marker');
    expect((await api.archiveContainer(worker)).status).toBe(200);
    expect((await api.unarchiveWorker(worker)).status).toBe(200);
    await waitForWorkerRunning(context, worker);
    await ready(worker);
    expect((await exec(worker, `jq -r '.model' ~/.config/opencode/opencode.json`)).trim()).toBe('zen/gpt-5-nano');
    await exec(worker, 'test -f ~/.local/share/opencode/session-marker && test -f ~/.local/state/opencode/ui-marker');
    // JSONC is also user-owned; setup must not seed a shadowing JSON config.
    await exec(worker, 'mv ~/.config/opencode/opencode.json ~/.config/opencode/opencode.jsonc && /home/agent/agents/opencode/setup.sh && test ! -f ~/.config/opencode/opencode.json');
    expect((await exec(worker, `jq -r '.model' ~/.config/opencode/opencode.jsonc`)).trim()).toBe('zen/gpt-5-nano');
  });

  test('exports and restores settings and sessions without provider credentials', async () => {
    await exec(worker, `printf '%s' '{"zen":{"type":"oauth","access":"zen-export-must-not-leak","refresh":"zen-refresh-must-not-leak","expires":4102444800000,"accountId":"org-test"}}' > ~/.local/share/opencode/auth.json`);
    await exec(worker, `opencode api POST /api/credential --data '{\"integrationID\":\"zen\",\"value\":{\"type\":\"key\",\"key\":\"sqlite-export-must-not-leak\"}}'`);
    const exported = await api.exportWorker(worker, false);
    expect(exported.status).toBe(200);
    // Inspect the nested agents tar rather than searching compressed bytes.
    const outer = Buffer.from(exported.body);
    let agents: Buffer | undefined;
    for (let offset = 0; offset + 512 <= outer.length;) {
      const name = outer.subarray(offset, offset + 100).toString().replace(/\0.*$/, '');
      const size = parseInt(outer.subarray(offset + 124, offset + 136).toString().replace(/\0.*$/, '').trim(), 8) || 0;
      if (name === 'agents.tar.gz') agents = gunzipSync(outer.subarray(offset + 512, offset + 512 + size));
      offset += 512 + Math.ceil(size / 512) * 512;
    }
    expect(agents).toBeDefined();
    const leakedFiles: string[] = [];
    for (let offset = 0; offset + 512 <= agents!.length;) {
      const name = agents!.subarray(offset, offset + 100).toString().replace(/\0.*$/, '');
      const size = parseInt(agents!.subarray(offset + 124, offset + 136).toString().replace(/\0.*$/, '').trim(), 8) || 0;
      if (agents!.subarray(offset + 512, offset + 512 + size).includes(Buffer.from('sqlite-export-must-not-leak'))) leakedFiles.push(name);
      offset += 512 + Math.ceil(size / 512) * 512;
    }
    expect(leakedFiles).toEqual([]);
    expect(agents!.includes(Buffer.from('zen-export-must-not-leak'))).toBe(false);
    expect(agents!.includes(Buffer.from('zen-refresh-must-not-leak'))).toBe(false);
    expect(agents!.includes(Buffer.from('opencode/data/auth.json'))).toBe(false);
    expect(agents!.includes(Buffer.from('opencode/state/agentor-credential-sync.json'))).toBe(false);
    const restored = await api.importWorker(outer);
    expect(restored.status).toBe(201);
    imported = restored.body.id;
    await waitForWorkerRunning(context, imported);
    await ready(imported);
    await exec(imported, 'test -f ~/.config/opencode/opencode.jsonc && test -f ~/.local/share/opencode/session-marker');
    expect((await api.resetAccountAgentCredential('opencode')).status).toBe(200);
  });

  test('can reach Zen in a restricted environment without package-manager domains', async () => {
    const env = await api.createEnvironment({
      name: 'Restricted Zen', dockerEnabled: false, networkMode: 'custom',
      allowedDomains: [], includePackageManagerDomains: false,
    });
    expect(env.status).toBe(201);
    restrictedEnv = env.body.id;
    restricted = (await createWorker(context, { environmentId: restrictedEnv })).id;
    await ready(restricted);
    const payload = JSON.parse(await exec(restricted, 'printenv ENVIRONMENT'));
    expect(payload.allowedDomains).toContain('opencode.ai');
    expect(payload.allowedDomains).toContain('models.dev');
    const models = await exec(restricted, "curl -fsS --max-time 20 -A 'opencode/2' https://opencode.ai/zen/v1/models | jq -r '.data[0].id'");
    expect(models.trim()).not.toBe('');
  });
});
