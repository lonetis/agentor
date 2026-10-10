import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import plugin, { createConsole } from '../../worker/agents/opencode/zen-console.mjs';
import { activeCredential, credentialBridge, entries, readCredentials, writeCredentials } from '../../worker/agents/opencode/credentials.mjs';

const fresh = () => ({ type: 'oauth', methodID: 'device', access: 'test-access', refresh: 'test-refresh',
  expires: Date.now() + 3_600_000, metadata: { orgID: 'org-test' } });
async function fixture(t, credential, handle) {
  const dir = await mkdtemp(join(tmpdir(), 'agentor-console-'));
  await mkdir(join(dir, 'data/opencode'), { recursive: true });
  const authPath = join(dir, 'data/opencode/auth.json');
  const setAuth = async value => writeFile(authPath, JSON.stringify(value ? { zen: value } : {}));
  await setAuth(credential);
  const calls = [];
  let origin;
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString();
      const call = { path: req.url, body: raw ? JSON.parse(raw) : undefined, headers: req.headers };
      calls.push(call);
      let result = await handle?.(call);
      if (!result) {
        if (req.url === '/console/auth/device/code') result = { device_code: 'device-test', user_code: 'CODE-TEST',
          verification_uri_complete: `${origin}/console/device?code=CODE-TEST`, expires_in: 60, interval: 0.001 };
        if (req.url === '/console/auth/device/token') result = { access_token: 'next-access', refresh_token: 'next-refresh', expires_in: 3600, org_id: 'org-test' };
        if (req.url === '/console/api/orgs') result = [{ id: 'org-test', name: 'Test organization' }];
        if (req.url.startsWith('/inference/')) result = { error: { type: 'invalid_request_error', message: 'Local request captured' } };
        if (req.url === '/console/api/v2/config') result = { providers: {
          opencode: { package: '@opencode/ai/providers/openai-compatible', settings: { baseURL: `${origin}/inference/openai/v1` },
            models: {
              'gpt-6.1-sol': { package: '@opencode/ai/providers/openai', variants: [{ id: 'max', settings: { reasoningEffort: 'max' } }] },
              'claude-sonnet-4-6': { package: '@opencode/ai/providers/anthropic', settings: { baseURL: `${origin}/inference/anthropic/v1` } },
            } },
          'opencode-go': { models: { 'go-model': {} } },
        } };
      }
      res.writeHead(result?.error ? 400 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result ?? {}));
    } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  const options = { consoleUrl: `${origin}/console`, authPath };
  return { console: createConsole(options), options, setAuth, origin, authPath, calls, dir };
}

test('device OAuth waits for approval and returns OpenCode 2 credentials with organization scope', async t => {
  let polls = 0;
  const f = await fixture(t, undefined, ({ path }) => path.endsWith('/device/token') && polls++ === 0 ? { error: 'authorization_pending' } : undefined);
  const login = await f.console.authorize();
  assert.equal(login.mode, 'auto');
  assert.match(login.instructions, /CODE-TEST/);
  const credential = await login.callback;
  assert.equal(credential.type, 'oauth');
  assert.equal(credential.methodID, 'device');
  assert.equal(credential.metadata.orgID, 'org-test');
  assert.equal(polls, 2);
  assert.equal(f.calls[0].body.supports_org_scope, true);
  assert.equal(await f.console.readAuth(), undefined, 'the native CLI owns the initial save');
});

test('device OAuth honors slow_down', async t => {
  let polls = 0;
  const f = await fixture(t, undefined, ({ path }) => path.endsWith('/device/token') && polls++ === 0 ? { error: 'slow_down' } : undefined);
  const start = Date.now();
  assert.equal((await (await f.console.authorize()).callback).type, 'oauth');
  assert.ok(Date.now() - start >= 5000);
});
for (const error of ['access_denied', 'expired_token']) {
  test(`device OAuth reports ${error}`, async t => {
    const f = await fixture(t, undefined, ({ path }) => path.endsWith('/device/token') ? { error } : undefined);
    await assert.rejects((await f.console.authorize()).callback, new RegExp(error));
    assert.equal(await f.console.readAuth(), undefined);
  });
}

test('workers serialize token refresh on the shared credentials inode', async t => {
  let refreshes = 0;
  const f = await fixture(t, { ...fresh(), expires: 0 }, async ({ path, body }) => {
    if (path.endsWith('/device/token')) {
      refreshes++;
      assert.equal(body.refresh_token, 'test-refresh');
      await new Promise(resolve => setTimeout(resolve, 30));
    }
  });
  await Promise.all([f.console.currentToken(), createConsole(f.options).currentToken()]);
  assert.equal(refreshes, 1);
  assert.equal((await f.console.readAuth()).access, 'next-access');
});

test('Reset during a token refresh cannot restore the account', async t => {
  let f;
  f = await fixture(t, { ...fresh(), expires: 0 }, async ({ path }) => { if (path.endsWith('/device/token')) await f.setAuth(undefined); });
  await assert.rejects(f.console.currentToken(), /changed during refresh/);
  assert.equal(await f.console.readAuth(), undefined);
});

test('credential bridge keeps imported credentials stable, shares native login and applies external Reset', async t => {
  const f = await fixture(t, { type: 'api', key: 'saved-key' });
  let database = [];
  let mutations = 0;
  const api = { list: async () => structuredClone(database),
    remove: async id => { mutations++; database = database.filter(item => item.id !== id); },
    create: async item => {
      mutations++;
      const active = item.active || !database.some(other => other.integrationID === item.integrationID);
      if (active) for (const other of database) if (other.integrationID === item.integrationID) other.active = false;
      const value = item.value.type === 'oauth' ? { type: 'oauth', methodID: item.value.methodID,
        refresh: item.value.refresh, access: item.value.access, expires: item.value.expires,
        metadata: Object.fromEntries(Object.entries(item.value.metadata).reverse()) } : item.value;
      database.push(structuredClone({ ...item, label: item.label ?? 'default', value, active }));
    }, update: async (id, updates) => { mutations++; Object.assign(database.find(item => item.id === id), structuredClone(updates)); },
    activate: async id => {
      mutations++;
      const current = database.find(item => item.id === id);
      for (const other of database) if (other.integrationID === current.integrationID) other.active = other.id === id;
    } };
  const bridge = credentialBridge(f.authPath, api, { statePath: join(f.dir, 'state/bridge.json') });
  await bridge.sync();
  assert.equal(database[0].value.type, 'key');
  assert.equal(database[0].value.key, 'saved-key');
  await f.setAuth({ ...fresh(), metadata: { orgID: 'org-test', orgName: 'Test organization' } });
  await bridge.sync();
  const imported = mutations;
  for (let i = 0; i < 3; i++) assert.equal(await bridge.sync(), false);
  assert.equal(mutations, imported, 'reordered OAuth fields and metadata must not reconnect the account');
  const unlabeled = await readCredentials(f.authPath);
  delete unlabeled[0].label;
  await writeFile(f.authPath, JSON.stringify({ credentials: unlabeled }));
  await bridge.sync();
  assert.equal(database[0].label, 'Console account');
  const defaulted = mutations;
  for (let i = 0; i < 3; i++) assert.equal(await bridge.sync(), false);
  assert.equal(mutations, defaulted, 'native defaults must not cause repeated imports');
  database[0].value = fresh();
  await bridge.sync();
  assert.equal(activeCredential(await readCredentials(f.authPath)).type, 'oauth');
  await f.setAuth(undefined);
  await bridge.sync();
  assert.deepEqual(database, []);
  assert.deepEqual(entries(JSON.parse(await readFile(f.authPath, 'utf8'))), []);
});

test('native OpenCode 2 loads the plugin, supports max and saves Console OAuth in shared credentials',
  { skip: !process.env.OPENCODE_CLI, timeout: 90_000 }, async t => {
    let configAttempts = 0;
    const f = await fixture(t, undefined, ({ path }) => {
      if (path === '/console/api/v2/config' && ++configAttempts === 1) throw new Error('Temporary Console outage');
    });
    const configDir = join(f.dir, 'config/opencode');
    await mkdir(join(configDir, 'plugins'), { recursive: true });
    const pluginURL = pathToFileURL(fileURLToPath(new URL('../../worker/agents/opencode/zen-console.mjs', import.meta.url))).href;
    await writeFile(join(configDir, 'plugins/zen-console.js'), `import plugin from ${JSON.stringify(pluginURL)};
      export default { ...plugin, setup: ctx => plugin.setup({...ctx, options: ${JSON.stringify({ ...f.options, binary: process.env.OPENCODE_CLI, catalogPath: process.env.OPENCODE_CATALOG })}}) };`);
    const configPath = join(configDir, 'opencode.json');
    const config = { update: 'disable', providers: {zen: {env: ['OPENCODE_ZEN_API_KEY']}} };
    await writeFile(configPath, JSON.stringify(config));
    const cli = spawn(process.env.OPENCODE_CLI, ['--print-logs', 'serve', '--hostname', '127.0.0.1', '--port', '0'], {
      cwd: f.dir, env: { ...process.env, OPENAI_API_KEY: 'local-test-key', XDG_CONFIG_HOME: join(f.dir, 'config'), XDG_DATA_HOME: join(f.dir, 'data'), XDG_STATE_HOME: join(f.dir, 'state') }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    cli.stdout.on('data', data => { output += data; });
    cli.stderr.on('data', data => { output += data; });
    t.after(() => cli.kill());
    const until = async callback => {
      const deadline = Date.now() + 40_000;
      while (true) {
        try { const result = await callback(); if (result) return result; }
        catch (error) { if (Date.now() > deadline) throw error; }
        if (Date.now() > deadline || cli.exitCode !== null) throw new Error(`OpenCode startup failed: ${output.slice(-2500)}`);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    };
    await until(() => /server password (\S+)/.test(output));
    const url = /server listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)[1];
    const password = /server password (\S+)/.exec(output)[1];
    const api = async (path, body, method = body ? 'POST' : 'GET') => {
      const response = await fetch(`${url}/api${path}`, { method,
        headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` },
        ...(body && {body: JSON.stringify(body)}), signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`${path}: ${response.status}: ${await response.text()}\n${output.slice(-5000)}`);
      return response.status === 204 ? undefined : (await response.json()).data;
    };
    const models = await until(async () => {
      const models = await api('/model');
      return models.find(model => model.providerID === 'zen' && model.id === 'gpt-6.1-sol') ? models : undefined;
    });
    const sol = models.find(model => model.providerID === 'zen' && model.id === 'gpt-6.1-sol');
    const automatic = await api('/model/default');
    assert.equal(automatic.providerID, 'zen');
    assert.equal(automatic.status, 'active');
    assert.equal(automatic.capabilities.tools, true);
    assert.ok(automatic.capabilities.input.includes('text'));
    assert.ok(automatic.capabilities.output.includes('text'));
    for (const model of models.filter(model => model.providerID === 'zen' && model.status === 'active' &&
      model.capabilities.tools && model.capabilities.input.includes('text') && model.capabilities.output.includes('text'))) {
      assert.ok(automatic.time.released >= model.time.released, `A newer stable Zen model is available: ${model.id}`);
    }
    await writeFile(configPath, JSON.stringify({ ...config, providers: { zen: { ...config.providers.zen,
      models: { [automatic.id]: { capabilities: { tools: false } } } } } }));
    await until(async () => (await api('/model')).find(model => model.providerID === 'zen' && model.id === automatic.id)?.capabilities.tools === false);
    const coding = await api('/model/default');
    assert.equal(coding.providerID, 'zen');
    assert.notEqual(coding.id, automatic.id);
    assert.equal(coding.capabilities.tools, true);
    await writeFile(configPath, JSON.stringify({ ...config, providers: { zen: { ...config.providers.zen,
      models: Object.fromEntries(models.filter(model => model.providerID === 'zen')
        .map(model => [model.id, { disabled: model.id !== 'gpt-5-nano' }])) } } }));
    await until(async () => (await api('/model')).filter(model => model.providerID === 'zen').length === 1);
    const restricted = await api('/model/default');
    assert.equal(restricted.providerID, 'zen');
    assert.equal(restricted.id, 'gpt-5-nano');
    await writeFile(configPath, JSON.stringify({ ...config, model: {providerID: 'zen', model: 'claude-sonnet-4-6'} }));
    await until(async () => (await api('/model/default')).id === 'claude-sonnet-4-6');
    assert.deepEqual(sol.variants.map(variant => variant.id), ['low', 'medium', 'high', 'xhigh', 'max']);
    assert.equal(sol.settings?.reasoningEffort, undefined);
    const integration = (await api('/integration')).find(item => item.id === 'zen');
    assert.ok(integration.methods.some(method => method.type === 'oauth' && method.id === 'device'));
    const login = await api('/integration/zen/connect/oauth', {methodID: 'device'});
    assert.equal(login.mode, 'auto');
    await until(async () => {
      const status = await api(`/integration/zen/connect/oauth/${login.attemptID}`);
      if (status.status === 'failed') throw new Error(status.message);
      return status.status === 'complete';
    });
    await until(async () => (await f.console.readAuth())?.type === 'oauth');
    assert.equal((await f.console.readAuth()).metadata.orgID, 'org-test');
    await until(async () => {
      const model = (await api('/model')).find(model => model.providerID === 'zen' && model.id === 'claude-sonnet-4-6');
      return model?.settings?.baseURL === `${f.origin}/inference/anthropic/v1`;
    });
    assert.ok(configAttempts >= 2, 'Console metadata must recover without another login after a temporary failure');
    const session = await api('/session', { title: 'Local transport check',
      model: { providerID: 'zen', id: 'gpt-6.1-sol', variant: 'max' } });
    await api(`/session/${session.id}/prompt`, { text: 'Capture this local request' });
    const inference = await until(() => f.calls.find(call => call.path.startsWith('/inference/')));
    assert.equal(inference.path, '/inference/openai/v1/responses');
    assert.equal(inference.headers.authorization, 'Bearer next-access');
    assert.equal(inference.headers['x-opencode-org-id'], 'org-test');
    assert.equal(inference.body.reasoning.effort, 'max');
    // Reproduce workers with saved provider-map OAuth: the native API returns
    // the same token with a different field order. It must stay connected.
    await f.setAuth(await f.console.readAuth());
    await until(async () => (await api('/credential')).some(item => item.integrationID === 'zen' && item.label === 'Console account'));
    const credentialMutations = () => (output.match(/\bcredential (?:created|removed|activated)\b/g) ?? []).length;
    const settled = credentialMutations();
    await new Promise(resolve => setTimeout(resolve, 3200));
    assert.equal(credentialMutations(), settled, 'saved OAuth must remain connected across multiple synchronization ticks');
    assert.equal((await api('/credential')).find(item => item.integrationID === 'zen')?.active, true);
    const oauthID = (await api('/credential')).find(item => item.integrationID === 'zen').id;
    await api('/integration/zen/connect/key', { key: 'second-zen-key' });
    await api('/integration/openrouter/connect/key', { key: 'local-router-key' });
    await until(async () => (await readCredentials(f.authPath)).length === 3);
    const saved = await readCredentials(f.authPath);
    const zenKey = saved.find(item => item.integrationID === 'zen' && item.value.type === 'key');
    const router = saved.find(item => item.integrationID === 'openrouter');
    saved.find(item => item.id === oauthID).label = 'Renamed Console';
    router.value.key = 'rotated-router-key';
    await writeCredentials(f.authPath, saved);
    await until(async () => {
      const credentials = await api('/credential');
      return credentials.find(item => item.id === oauthID)?.label === 'Renamed Console' &&
        credentials.find(item => item.id === router.id)?.value.key === 'rotated-router-key';
    });
    await api(`/credential/${oauthID}/activate`, undefined, 'POST');
    await until(async () => (await readCredentials(f.authPath)).find(item => item.id === oauthID)?.active);
    await api(`/credential/${zenKey.id}`, undefined, 'DELETE');
    await until(async () => (await readCredentials(f.authPath)).length === 2);
    assert.deepEqual((await readCredentials(f.authPath)).map(item => item.id).sort(), [oauthID, router.id].sort());
    await f.setAuth(undefined);
    await until(async () => (await api('/credential')).length === 0);
    assert.equal((await api('/model')).some(model => model.providerID === 'opencode-go'), false);
  });
