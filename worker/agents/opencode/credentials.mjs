import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export async function locked(path, callback) {
  const lock = spawn('flock', ['-x', '-w', '25', path, 'sh', '-c', 'printf ready; cat >/dev/null'],
    { stdio: ['pipe', 'pipe', 'ignore'] });
  try {
    await new Promise((resolve, reject) => {
      lock.once('error', reject);
      lock.once('exit', code => reject(new Error(`Credential lock exited: ${code}`)));
      lock.stdout.once('data', resolve);
    });
    return await callback();
  } finally { lock.stdin.end(); }
}

export function entries(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return [];
  if (Array.isArray(input.credentials)) return input.credentials;
  // Import the credentials saved before upgrading the worker to OpenCode 2.
  return Object.entries(input).flatMap(([integrationID, value]) => {
    if (!value || typeof value !== 'object') return [];
    if (value.type === 'api') value = { type: 'key', key: value.key };
    if (value.type === 'wellknown') value = { type: 'key', key: value.token };
    if (value.type === 'oauth') value = { type: 'oauth', access: value.access, refresh: value.refresh,
      expires: value.expires, methodID: value.methodID ?? (integrationID === 'openai' ? 'chatgpt-browser'
        : ['zen', 'opencode', 'github-copilot', 'xai'].includes(integrationID) ? 'device' : 'oauth'),
      metadata: { ...value.metadata,
        ...(value.accountId && { [integrationID === 'zen' ? 'orgID' : 'accountID']: value.accountId }),
        ...(value.enterpriseUrl && { enterpriseUrl: value.enterpriseUrl }) } };
    if (!['key', 'oauth', 'external'].includes(value.type)) return [];
    return [{ id: `cred_${createHash('sha256').update(integrationID).digest('hex').slice(0, 26)}`,
      integrationID, label: value.type === 'oauth' ? 'Console account' : 'API key', active: true, value }];
  });
}

async function readDocument(path) {
  const input = JSON.parse(await readFile(path, 'utf8'));
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      ('credentials' in input && !Array.isArray(input.credentials))) throw new Error('Invalid credential document');
  const credentials = entries(input);
  if (!('credentials' in input) && credentials.length !== Object.keys(input).length) throw new Error('Invalid credential document');
  const ids = new Set();
  for (const item of credentials) {
    const value = item?.value;
    const validValue = value?.type === 'key' ? typeof value.key === 'string' && value.key.length > 0
      : value?.type === 'oauth' ? typeof value.access === 'string' && value.access.length > 0 &&
        typeof value.refresh === 'string' && value.refresh.length > 0 && Number.isSafeInteger(value.expires) &&
        typeof value.methodID === 'string' && value.methodID.length > 0
      : value?.type === 'external' && typeof value.methodID === 'string' && value.methodID.length > 0;
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) ||
        typeof item.integrationID !== 'string' || !item.integrationID || typeof item.active !== 'boolean' ||
        (item.label !== undefined && typeof item.label !== 'string') ||
        !validValue) throw new Error('Invalid credential entry');
    ids.add(item.id);
  }
  const sync = input.sync ?? { version: 1, resetID: null, deleted: [] };
  if (sync.version !== 1 ||
      (sync.resetID !== null && typeof sync.resetID !== 'string') ||
      !Array.isArray(sync.deleted) || sync.deleted.some(id => typeof id !== 'string')) throw new Error('Invalid credential sync metadata');
  return { credentials, sync: { version: 1, resetID: sync.resetID, deleted: sync.deleted } };
}
export async function readCredentials(path) { return (await readDocument(path)).credentials; }
export function activeCredential(items, integrationID = 'zen') {
  return items.find(item => item.integrationID === integrationID && item.active)?.value
    ?? items.find(item => item.integrationID === integrationID)?.value;
}
export async function writeCredentials(path, items) {
  const document = await readDocument(path);
  const ids = new Set(items.map(item => item.id));
  const deleted = new Set(document.sync.deleted);
  for (const item of document.credentials) if (!ids.has(item.id)) deleted.add(item.id);
  await writeDocument(path, { credentials: items,
    sync: { ...document.sync, deleted: [...deleted].sort() } });
}
async function writeDocument(path, document) {
  // Retain the inode of the per-user Docker bind mount, including on Reset.
  await writeFile(path, JSON.stringify(document), { mode: 0o600 });
}

// The plugin API exposes integration connections but not credential CRUD.
// Use OpenCode's public global HTTP API, keeping each worker's SQLite private.
export async function credentialAPI(binary = 'opencode') {
  const state = process.env.XDG_STATE_HOME ?? join(homedir(), '.local/state');
  let endpoint;
  let child;
  try {
    const info = JSON.parse(await readFile(join(state, 'opencode/service.json'), 'utf8'));
    if (info.pid === process.pid) endpoint = info;
  } catch { /* A standalone CLI has no background-service registration. */ }
  if (!endpoint) {
    // The worker runs on Linux. Terminate a standalone helper if its OpenCode
    // parent is killed, including when the terminal is closed abruptly.
    child = spawn('python3', ['-c',
      'import ctypes, os, signal, sys; parent = os.getppid(); ctypes.CDLL(None).prctl(1, signal.SIGTERM, 0, 0, 0); os.getppid() == parent or sys.exit(1); os.execvp(sys.argv[1], sys.argv[1:])',
      binary, 'serve', '--hostname', '127.0.0.1', '--port', '0'],
      { stdio: ['ignore', 'pipe', 'ignore'] });
    endpoint = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('Credential API startup timed out')); }, 20_000);
      child.once('error', reject);
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Credential API exited: ${code}`)); });
      child.stdout.on('data', data => {
        output += data;
        const url = /server listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1];
        const password = /server password (\S+)/.exec(output)?.[1];
        if (url && password) { clearTimeout(timer); resolve({ url, password }); }
      });
    });
  }
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(`${endpoint.url}/api/credential${path}`, {
      method, signal: AbortSignal.timeout(20_000),
      headers: { 'content-type': 'application/json',
        authorization: `Basic ${Buffer.from(`opencode:${endpoint.password}`).toString('base64')}` },
      ...(body && { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`Credential API: HTTP ${response.status}`);
    return response.status === 204 ? undefined : (await response.json()).data;
  };
  const update = async (id, updates, previousValue) => {
    // OpenCode 2's public PATCH accepts only a label. Update token values in
    // place in this worker's private SQLite, retaining IDs and active accounts.
    // Send secrets over stdin so process arguments and CLI logs never contain them.
    if (updates.value !== undefined) {
      const data = process.env.XDG_DATA_HOME ?? join(homedir(), '.local/share');
      const updater = spawn('python3', ['-c', `
import json, sqlite3, sys, time
payload = json.load(sys.stdin)
db = sqlite3.connect('file:' + sys.argv[1] + '?mode=rw', uri=True, timeout=20)
db.execute('BEGIN IMMEDIATE')
row = db.execute('SELECT value FROM credential WHERE id=?', (payload['id'],)).fetchone()
if row and json.loads(row[0]) == payload['previous']:
    db.execute('UPDATE credential SET value=?, time_updated=? WHERE id=?',
        (json.dumps(payload['value']), int(time.time()*1000), payload['id']))
db.commit()
db.close()
`,
        join(data, 'opencode/opencode.db')], { stdio: ['pipe', 'ignore', 'ignore'] });
      await new Promise((resolve, reject) => {
        updater.once('error', reject);
        updater.stdin.once('error', reject);
        updater.once('exit', code => code === 0 ? resolve() : reject(new Error('Credential value update failed')));
        updater.stdin.end(JSON.stringify({ id, value: updates.value, previous: previousValue }));
      });
    }
    if (updates.label !== undefined) await request(`/${encodeURIComponent(id)}`, 'PATCH', { label: updates.label });
  };
  return {
    list: () => request(''),
    create: item => request('', 'POST', { ...item, activate: item.active }),
    update,
    remove: id => request(`/${encodeURIComponent(id)}`, 'DELETE'),
    activate: id => request(`/${encodeURIComponent(id)}/activate`, 'POST'),
    close: () => child?.kill(),
  };
}

const canonical = value => JSON.stringify(value,
  // Native credential DTOs reorder OAuth fields and nested metadata. Compare
  // their values, otherwise each poll disconnects and recreates the account.
  (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
const normalized = items => canonical(items.map(item => ({ id: item.id, integrationID: item.integrationID,
  label: item.label, active: item.active, value: item.value })).sort((a, b) => a.id.localeCompare(b.id)));
const hash = value => createHash('sha256').update(canonical(value) ?? 'undefined').digest('hex');
const fingerprints = items => Object.fromEntries(items.map(item => [item.id, {
  integrationID: item.integrationID, label: hash(item.label), value: hash(item.value), active: item.active,
}]));
const activeIDs = items => new Map(items.filter(item => item.active).map(item => [item.integrationID, item.id]));
const activeBase = records => activeIDs(Object.entries(records ?? {}).map(([id, item]) => ({ id, ...item })));

async function readState(path) {
  try {
    const state = JSON.parse(await readFile(path, 'utf8'));
    if (state.version !== 1 || !state.local || !state.shared) throw new Error('Invalid credential sync state');
    return state;
  } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}
async function writeState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
  await rename(temporary, path);
}

export function credentialBridge(path, api, { statePath = join(process.env.XDG_STATE_HOME ??
  join(homedir(), '.local/state'), 'opencode/agentor-credential-sync.json') } = {}) {
  let pending = Promise.resolve();
  const sync = async () => locked(path, async () => {
    // Read the persisted baseline under the shared lock as multiple CLI
    // processes can use the same worker database. It contains hashes, not tokens.
    let document;
    let previous;
    try {
      document = await readDocument(path);
      previous = await readState(statePath);
    } catch {
      // A missing, partially written or malformed file is not a logout. Retry
      // next tick, including during plugin startup, without touching SQLite.
      return false;
    }
    const database = await api.list();
    const shared = new Map(document.credentials.map(item => [item.id, structuredClone(item)]));
    const deleted = new Set(document.sync.deleted);
    const reset = previous ? document.sync.resetID !== previous.resetID : document.sync.resetID !== null;

    // Files written by earlier Agentor versions have no deletion metadata.
    // Infer removals only for IDs that this worker previously saw in the file.
    for (const id of Object.keys(previous?.shared ?? {})) if (!shared.has(id)) deleted.add(id);
    if (!reset) {
      const local = new Map(database.map(item => [item.id, item]));
      for (const id of Object.keys(previous?.local ?? {})) {
        if (!local.has(id)) { shared.delete(id); deleted.add(id); }
      }
      for (const item of database) {
        if (deleted.has(item.id)) continue;
        const base = previous?.local[item.id];
        const remoteBase = previous?.shared[item.id];
        const remote = shared.get(item.id);
        if (!remote) {
          shared.set(item.id, structuredClone(item));
          continue;
        }
        if (!base) continue; // An existing shared ID wins on the first import.
        for (const field of ['label', 'value']) {
          // Merge independent edits (e.g. rename + token refresh). For a
          // concurrent edit of the same field, the shared commit wins.
          if (hash(item[field]) !== base[field] && hash(remote[field]) === remoteBase?.[field]) {
            remote[field] = structuredClone(item[field]);
          }
        }
      }

      const active = activeIDs([...shared.values()]);
      const baseline = activeBase(previous?.local);
      for (const [integrationID, id] of activeIDs(database)) {
        if (shared.has(id) && (previous ? id !== baseline.get(integrationID) :
          !document.credentials.some(item => item.id === id))) active.set(integrationID, id);
      }
      // Activity belongs to a provider, not the whole list. Serialize explicit
      // local switches with other commits and keep one active account per provider.
      for (const item of shared.values()) item.active = active.get(item.integrationID) === item.id;
    }

    for (const id of deleted) shared.delete(id);
    // Removing an active account leaves the provider's remaining account usable.
    for (const item of shared.values()) {
      if (![...shared.values()].some(other => other.integrationID === item.integrationID && other.active)) item.active = true;
    }
    const desired = [...shared.values()];
    const nextDocument = { credentials: desired,
      sync: { ...document.sync, deleted: [...deleted].sort() } };
    if (normalized(desired) !== normalized(document.credentials) ||
        canonical(nextDocument.sync) !== canonical(document.sync)) {
      // Commit the local delta before importing it so a crash cannot lose a login.
      await writeDocument(path, nextDocument);
    }

    // Select the destination before deleting an active account. Native DELETE
    // would otherwise activate an arbitrary remaining account; a later failed
    // PATCH would make that fallback look like a user switch on the next tick.
    const expectedActive = activeIDs(database);
    const existing = new Set(database.map(item => item.id));
    for (const item of [...desired].sort((a, b) => Number(b.active) - Number(a.active))) {
      if (existing.has(item.id)) continue;
      // An inactive import must not override a login made during this request.
      // OpenCode still activates the first account of a new provider.
      await api.create({ ...item, active: false });
      if (!expectedActive.has(item.integrationID)) expectedActive.set(item.integrationID, item.id);
    }
    for (const item of desired.filter(item => item.active)) {
      const current = activeIDs(await api.list()).get(item.integrationID);
      // A changed selection since the initial snapshot belongs to the user.
      if (current === expectedActive.get(item.integrationID) && current !== item.id) {
        await api.activate(item.id);
      }
    }
    for (const item of database) {
      const next = shared.get(item.id);
      if (!next) await api.remove(item.id);
      else if (next.integrationID !== item.integrationID) throw new Error('Credential integration cannot change');
      else {
        const updates = {};
        if (next.label !== undefined && next.label !== item.label) updates.label = next.label;
        if (canonical(next.value) !== canonical(item.value)) updates.value = next.value;
        if (Object.keys(updates).length) await api.update(item.id, updates, item.value);
      }
    }
    const actual = await api.list();
    // A CLI can add/edit credentials while HTTP imports are in flight. Only
    // acknowledge the desired records; later changes remain a delta for next tick.
    const acknowledged = desired.map(item => ({ ...item,
      label: item.label ?? actual.find(entry => entry.id === item.id)?.label }));
    const state = { version: 1, resetID: nextDocument.sync.resetID,
      shared: fingerprints(desired), local: fingerprints(acknowledged) };
    const changed = canonical(fingerprints(actual)) !== canonical(previous?.local);
    if (canonical(state) !== canonical(previous)) await writeState(statePath, state);
    return changed;
  });
  return { sync() {
    const next = pending.then(sync);
    pending = next.catch(() => {});
    return next;
  } };
}
