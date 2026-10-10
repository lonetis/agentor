import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { activeCredential, credentialAPI, credentialBridge, locked, readCredentials, writeCredentials } from './credentials.mjs';

const CONSOLE = 'https://opencode.ai/console';
const CLIENT_ID = 'opencode-cli';
const NAME = 'OpenCode Console (Zen)';

export function createConsole(options = {}) {
  const server = new URL(options.consoleUrl ?? CONSOLE);
  const authPath = options.authPath ?? join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local/share'), 'opencode/auth.json');
  const readAuth = async () => activeCredential(await readCredentials(authPath));
  const request = async (path, body, token, orgID) => {
    const response = await fetch(`${server.href.replace(/\/$/, '')}${path}`, {
      method: body ? 'POST' : 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
      headers: {
        accept: 'application/json',
        'user-agent': `opencode/${options.version ?? '2'}`,
        ...(body && { 'content-type': 'application/json' }),
        ...(token && { authorization: `Bearer ${token}` }),
        ...(orgID && { 'x-org-id': orgID }),
      },
      ...(body && { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (!response.ok && !(path === '/auth/device/token' && typeof data.error === 'string')) {
      throw new Error(`OpenCode Console ${path}: HTTP ${response.status}`);
    }
    return data;
  };
  const tokens = (data, previous) => {
    if (typeof data.access_token !== 'string' || !data.access_token ||
        typeof data.refresh_token !== 'string' || !data.refresh_token ||
        !Number.isFinite(data.expires_in) || data.expires_in <= 0) {
      throw new Error('OpenCode Console returned invalid OAuth credentials');
    }
    return { ...previous, type: 'oauth', methodID: 'device', access: data.access_token, refresh: data.refresh_token,
      expires: Date.now() + data.expires_in * 1000,
      ...(data.org_id && { metadata: { ...previous?.metadata, orgID: data.org_id } }) };
  };
  const save = async (body) => {
    const items = await readCredentials(authPath);
    const item = items.find(item => item.integrationID === 'zen' && item.active)
      ?? items.find(item => item.integrationID === 'zen');
    if (!item) throw new Error('Console account disconnected; reconnect');
    item.value = body;
    await writeCredentials(authPath, items);
  };

  const currentToken = async (getAuth = readAuth) => {
    let auth = await getAuth();
    if (auth?.type !== 'oauth') return auth;
    if (auth.expires > Date.now() + 300_000) return auth;
    // flock locks the credential file's inode across worker containers. The
    // shared JSON retains that inode for Agentor's nested bind mount.
    return locked(authPath, async () => {
      auth = await getAuth();
      if (auth?.type !== 'oauth') return auth;
      if (auth.expires > Date.now() + 300_000) return auth;
      const refreshed = tokens(await request('/auth/device/token', {
        grant_type: 'refresh_token', refresh_token: auth.refresh, client_id: CLIENT_ID,
      }), auth);
      const latest = await getAuth();
      if (latest?.type !== 'oauth' || latest.refresh !== auth.refresh) {
        throw new Error('Console credentials changed during refresh; reconnect');
      }
      await save(refreshed);
      return refreshed;
    });
  };

  const authorize = async () => {
  const device = await request('/auth/device/code', { client_id: CLIENT_ID, supports_org_scope: true });
  const verification = new URL(device.verification_uri_complete, `${server.href}/`);
  if (verification.origin !== server.origin || !device.device_code || !device.user_code ||
      !Number.isFinite(device.expires_in) || device.expires_in <= 0 ||
      !Number.isFinite(device.interval) || device.interval < 0) {
    throw new Error('Console returned invalid device authorization');
  }
  const deadline = Date.now() + device.expires_in * 1000;
  let interval = Math.max(1, device.interval * 1000);
  return {
    url: verification.href, mode: 'auto', expiresAt: deadline, instructions: `Enter code: ${device.user_code}`,
    callback: (async () => {
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(interval, deadline - Date.now())));
        if (Date.now() >= deadline) break;
        const data = await request('/auth/device/token', {
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: device.device_code, client_id: CLIENT_ID,
        });
        if (data.error === 'authorization_pending') continue;
        if (data.error === 'slow_down') { interval += 5000; continue; }
        if (data.error) throw new Error(`Console device authorization: ${data.error}`);
        const credential = tokens(data);
        const orgs = await request('/api/orgs', undefined, credential.access);
        if (!Array.isArray(orgs) || !orgs[0]?.id) throw new Error('Console account has no organization');
        const org = data.org_id ? orgs.find(org => org.id === data.org_id) : orgs[0];
        if (!org) throw new Error('Console organization unavailable');
        return { ...credential, metadata: { server: server.href.replace(/\/$/, ''), orgID: org.id, orgName: org.name } };
      }
      throw new Error('Console device authorization expired; try again');
    })(),
  };
};
  return { authorize, currentToken, request, readAuth, authPath, server };
}

export default {
  id: 'agentor.zen-console',
  async setup(ctx) {
    const console = createConsole({ ...ctx.options, version: ctx.app.version });
    const api = await credentialAPI(ctx.options?.binary);
    const bridge = credentialBridge(console.authPath, api);
    let remote;
    let metadataError;
    let retryAt = 0;
    let retryDelay = 1000;
    const failed = error => {
      metadataError = error;
      retryAt = Date.now() + retryDelay;
      retryDelay = Math.min(retryDelay * 2, 30_000);
    };
    const load = async () => {
      remote = undefined;
      metadataError = undefined;
      try {
        const auth = await console.currentToken();
        if (auth?.type !== 'oauth') { retryAt = 0; retryDelay = 1000; return; }
        const config = (await console.request('/api/v2/config', undefined, auth.access, auth.metadata?.orgID)).providers?.opencode;
        if (!config?.models) throw new Error('Console returned no Zen provider config');
        // Only provider metadata is consumed. Go, remote plugins, instructions
        // and additional MCP servers never alter the worker configuration.
        for (const url of [config.settings?.baseURL,
          ...Object.values(config.models).map(model => model.settings?.baseURL)].filter(Boolean)) {
          if (new URL(url).origin !== console.server.origin) throw new Error('Console provider API must use the Console origin');
        }
        remote = config;
        retryAt = 0;
        retryDelay = 1000;
      } catch (error) { failed(error); }
    };
    try {
      await bridge.sync();
      await load();
      const registrations = [];
      registrations.push(await ctx.integration.transform(editor => {
        editor.remove('opencode-go');
        editor.remove('opencode');
        editor.update('zen', integration => { integration.name = NAME; });
        editor.method.update({ integrationID: 'zen', method: {
          id: 'device', type: 'oauth', label: 'OpenCode Console account',
        }, authorize: console.authorize, refresh: () => console.currentToken(),
        label: credential => credential.metadata?.orgName });
        editor.method.update({ integrationID: 'zen', method: { type: 'key', label: 'API key (service account)' } });
      }));
      const catalog = JSON.parse(await readFile(ctx.options?.catalogPath ?? '/home/agent/agents/opencode/zen-provider.json', 'utf8'));
      registrations.push(await ctx.provider.transform(editor => {
        editor.remove('opencode-go');
        // OpenCode 2 already interprets models.dev reasoning_options using the
        // proper protocol for each model. Keep those native model definitions.
        const source = editor.get('opencode');
        if (source) {
          const provider = structuredClone(source.provider);
          provider.id = 'zen';
          provider.integrationID = 'zen';
          provider.name = NAME;
          provider.activation = 'enabled';
          delete provider.settings?.apiKey;
          const models = Object.keys(catalog.models).flatMap(id => {
            const model = source.models.get(id);
            if (!model) return [];
            const copy = structuredClone(model);
            copy.providerID = 'zen';
            copy.enabled = true;
            delete copy.settings?.apiKey;
            return [copy];
          });
          editor.add({info: provider, models});
          editor.remove('opencode');
        }
        if (!remote || metadataError) return;
        const clean = settings => Object.fromEntries(Object.entries(settings ?? {})
          .filter(([key]) => !['apiKey', 'authToken', 'accessToken'].includes(key)));
        editor.update('zen', provider => {
          delete provider.settings?.baseURL;
          provider.package = remote.package ?? provider.package;
          provider.settings = { ...clean(provider.settings), ...clean(remote.settings) };
          provider.headers = { ...provider.headers, ...remote.headers };
        });
        for (const [id, config] of Object.entries(remote.models)) {
          editor.models.update('zen', id, model => {
            model.package = config.package ?? model.package;
            if (remote.settings?.baseURL) delete model.settings?.baseURL;
            model.settings = { ...clean(model.settings), ...clean(config.settings) };
            model.headers = { ...model.headers, ...config.headers };
            model.body = { ...model.body, ...config.body };
            for (const variant of config.variants ?? []) {
              const index = model.variants.findIndex(item => item.id === variant.id);
              if (index < 0) model.variants.push(variant);
              else model.variants[index] = { ...model.variants[index], ...variant,
                settings: { ...model.variants[index].settings, ...variant.settings },
                headers: { ...model.variants[index].headers, ...variant.headers },
                body: { ...model.variants[index].body, ...variant.body } };
            }
          });
        }
      }));
      const selectDefault = editor => {
        // Respect explicit defaults from OpenCode's config model transform.
        if (editor.default.get()) return;
        const model = editor.list('zen')
          .filter(model => model.enabled && model.status === 'active' && model.capabilities.tools &&
            model.capabilities.input.some(type => type.startsWith('text')) &&
            model.capabilities.output.some(type => type.startsWith('text')))
          .sort((a, b) => b.time.released - a.time.released || a.id.localeCompare(b.id))[0];
        if (model) editor.default.set('zen', model.id);
      };
      let defaults = await ctx.model.transform(selectDefault);
      registrations.push({ dispose: () => defaults.dispose() });
      registrations.push(await ctx.session.hook('http.request', async event => {
        await tick();
        const auth = await console.currentToken();
        if (auth?.type !== 'oauth') {
          if (remote) throw new Error('Console account disconnected; reconnect');
          return;
        }
        if (metadataError) throw metadataError;
        if (!remote) throw new Error('Console provider config unavailable; reconnect');
        if (new URL(event.request.url).origin !== console.server.origin) throw new Error('Console provider API must use the Console origin');
        const headers = new Headers(event.request.headers);
        headers.delete('x-api-key');
        headers.delete('x-goog-api-key');
        headers.set('authorization', `Bearer ${auth.access}`);
        if (auth.metadata?.orgID) headers.set('x-opencode-org-id', auth.metadata.orgID);
        event.request = new Request(event.request, { headers, redirect: 'error' });
      }, { providerID: 'zen' }));
      let stopped = false;
      let running;
      const tick = async () => {
        if (stopped) return;
        if (running) return running;
        running = (async () => {
          try {
            const changed = await bridge.sync();
            if (changed || (metadataError && Date.now() >= retryAt)) {
              await load();
              await ctx.provider.reload();
            }
          } catch (error) { failed(error); }
        })();
        try { await running; }
        finally { running = undefined; }
      };
      const timer = setInterval(tick, 1000);
      timer.unref?.();
      const updates = new AbortController();
      const events = (async () => {
        for await (const event of ctx.event.subscribe({ signal: updates.signal })) {
          if (event.type === 'plugin.updated') {
            // Built-in config transforms register after external plugins.
            // Re-register last after activation so disabled/capability overrides
            // are applied before auto-selection, including after plugin reloads.
            const previous = defaults;
            defaults = await ctx.model.transform(selectDefault);
            await previous.dispose();
          }
          if (event.type === 'credential.updated' || event.type === 'credential.switched') await tick();
        }
      })().catch(error => { if (!stopped) metadataError = error; });
      return async () => {
        stopped = true;
        clearInterval(timer);
        updates.abort();
        try {
          await events;
          await running;
          await bridge.sync();
          await Promise.all(registrations.map(registration => registration.dispose()));
        } finally { api.close(); }
      };
    } catch (error) { api.close(); throw error; }
  },
};
