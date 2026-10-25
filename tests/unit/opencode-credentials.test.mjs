import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { credentialBridge, readCredentials, writeCredentials } from '../../worker/agents/opencode/credentials.mjs';

const account = (id, integrationID = 'zen') => ({ id: `cred_${id}`, integrationID, label: id,
  active: true, value: { type: 'key', key: `inert-${id}` } });
async function fixture(t, initial = [account('one')]) {
  const dir = await mkdtemp(join(tmpdir(), 'agentor-credentials-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'auth.json');
  await writeFile(path, JSON.stringify({ credentials: initial }));
  const workers = [];
  const worker = (seed = []) => {
    const database = structuredClone(seed);
    const operations = [];
    const api = {
      list: async () => structuredClone(database),
      create: async item => {
        operations.push(['create', item.id]);
        const active = item.active || !database.some(other => other.integrationID === item.integrationID);
        if (active) for (const other of database) if (other.integrationID === item.integrationID) other.active = false;
        database.push(structuredClone({ ...item, label: item.label ?? 'default', active }));
      },
      update: async (id, updates) => { operations.push(['update', id]); Object.assign(database.find(item => item.id === id), structuredClone(updates)); },
      remove: async id => {
        operations.push(['remove', id]);
        const removed = database.find(item => item.id === id);
        database.splice(database.findIndex(item => item.id === id), 1);
        if (removed.active) {
          const remaining = database.filter(item => item.integrationID === removed.integrationID);
          if (remaining.length) remaining.at(-1).active = true;
        }
      },
      activate: async id => {
        operations.push(['activate', id]);
        const current = database.find(item => item.id === id);
        for (const other of database) if (other.integrationID === current.integrationID) other.active = other.id === id;
      },
    };
    const statePath = join(dir, `worker-${workers.length}.json`);
    const result = { database, operations, api, statePath,
      bridge: credentialBridge(path, api, { statePath }),
      connect: item => api.create(item), disconnect: id => api.remove(id),
      restart() { this.bridge = credentialBridge(path, api, { statePath }); },
    };
    workers.push(result);
    return result;
  };
  const reset = async () => {
    await writeFile(path, JSON.stringify({ credentials: [], sync: { version: 1,
      resetID: randomUUID(), deleted: [] } }));
  };
  return { path, worker, reset, saved: () => readCredentials(path) };
}
const ids = items => items.map(item => item.id).sort();

test('first startup preserves unsynchronized SQLite accounts and waits for a readable shared file', async t => {
  const f = await fixture(t);
  const a = f.worker([account('router', 'openrouter')]);
  const saved = await readFile(f.path, 'utf8');
  await writeFile(f.path, '');
  assert.equal(await a.bridge.sync(), false);
  assert.deepEqual(ids(a.database), ['cred_router']);
  await writeFile(f.path, saved);
  await a.bridge.sync();
  assert.deepEqual(ids(a.database), ['cred_one', 'cred_router']);
  assert.deepEqual(ids(await f.saved()), ['cred_one', 'cred_router']);
});

test('concurrent connections in two workers preserve every provider and survive restart', async t => {
  const f = await fixture(t);
  const a = f.worker(), b = f.worker();
  await a.bridge.sync(); await b.bridge.sync();
  await a.connect(account('router', 'openrouter'));
  await b.connect(account('claude', 'anthropic'));
  b.restart();
  await Promise.all([a.bridge.sync(), b.bridge.sync()]);
  await a.bridge.sync();
  assert.deepEqual(ids(await f.saved()), ['cred_claude', 'cred_one', 'cred_router']);
  assert.deepEqual(ids(a.database), ids(b.database));
  const checkpoint = await readFile(b.statePath, 'utf8');
  assert.ok(!checkpoint.includes('inert-'), 'the persisted baseline must not duplicate API keys');
});

test('multiple accounts of one provider share switches and delete only the selected account', async t => {
  const f = await fixture(t);
  const a = f.worker(), b = f.worker();
  await a.bridge.sync(); await b.bridge.sync();
  await a.connect(account('two')); await b.connect(account('three'));
  await a.bridge.sync(); await b.bridge.sync(); await a.bridge.sync();
  assert.equal((await f.saved()).filter(item => item.active).length, 1);
  assert.equal(a.database.find(item => item.active).id, 'cred_three');
  await a.api.activate('cred_one');
  await a.bridge.sync(); await b.bridge.sync();
  assert.equal(b.database.find(item => item.active).id, 'cred_one');
  await a.disconnect('cred_two');
  b.database.find(item => item.id === 'cred_two').label = 'stale rename';
  await a.bridge.sync(); b.restart(); await b.bridge.sync();
  assert.deepEqual(ids(await f.saved()), ['cred_one', 'cred_three']);
  assert.ok(!b.database.some(item => item.id === 'cred_two'));
});

test('rename and token refresh merge without recreating credentials or changing their IDs', async t => {
  const f = await fixture(t);
  const a = f.worker(), b = f.worker();
  await a.bridge.sync(); await b.bridge.sync();
  a.operations.length = 0; b.operations.length = 0;
  a.database[0].label = 'Renamed';
  b.database[0].value.key = 'inert-refreshed';
  await a.bridge.sync(); await b.bridge.sync(); await a.bridge.sync();
  const saved = (await f.saved())[0];
  assert.equal(saved.label, 'Renamed');
  assert.equal(saved.value.key, 'inert-refreshed');
  assert.deepEqual(ids(a.database), ['cred_one']);
  assert.ok([...a.operations, ...b.operations].every(([operation]) => operation === 'update'));
});

test('Reset defeats offline changes and allows new logins after the reset is acknowledged', async t => {
  const f = await fixture(t);
  const a = f.worker(); await a.bridge.sync();
  await a.connect(account('unsaved', 'openrouter'));
  await f.reset(); a.restart(); await a.bridge.sync();
  assert.deepEqual(a.database, []);
  assert.deepEqual(await f.saved(), []);
  await a.connect(account('new', 'openrouter')); await a.bridge.sync();
  const stale = f.worker([account('one'), account('unsaved', 'openrouter')]);
  await stale.bridge.sync();
  assert.deepEqual(ids(await f.saved()), ['cred_new']);
  assert.deepEqual(ids(stale.database), ['cred_new']);
});

test('a deleted account cannot be restored by a worker without a checkpoint', async t => {
  const f = await fixture(t, [account('one'), account('router', 'openrouter')]);
  const a = f.worker(); await a.bridge.sync();
  await a.disconnect('cred_one'); await a.bridge.sync();
  const stale = f.worker([account('one')]); await stale.bridge.sync();
  assert.deepEqual(ids(await f.saved()), ['cred_router']);
  assert.deepEqual(ids(stale.database), ['cred_router']);
});

test('malformed or missing shared credentials never clear SQLite and recover after repair', async t => {
  const f = await fixture(t);
  const a = f.worker(); await a.bridge.sync();
  const saved = await readFile(f.path, 'utf8');
  for (const invalid of ['not-json', '{"credentials":{}}', '{"credentials":[{}]}', '{"zen":{}}']) {
    await writeFile(f.path, invalid);
    assert.equal(await a.bridge.sync(), false);
    assert.deepEqual(ids(a.database), ['cred_one']);
  }
  await rm(f.path);
  assert.equal(await a.bridge.sync(), false);
  assert.deepEqual(ids(a.database), ['cred_one']);
  await writeFile(f.path, saved);
  await a.bridge.sync();
  assert.deepEqual(ids(await f.saved()), ['cred_one']);
});

test('a same-provider login during import keeps its active selection and is shared after restart', async t => {
  const f = await fixture(t);
  const a = f.worker(); await a.bridge.sync();
  const saved = await f.saved(); saved[0].label = 'Remote rename';
  await writeCredentials(f.path, saved);
  const update = a.api.update;
  a.api.update = async (...args) => { await update(...args); await a.connect(account('during-import')); };
  await a.bridge.sync();
  assert.equal(a.database.find(item => item.active).id, 'cred_during-import');
  a.restart(); await a.bridge.sync();
  assert.deepEqual(ids(await f.saved()), ['cred_during-import', 'cred_one']);
  assert.equal((await f.saved()).find(item => item.active).id, 'cred_during-import');
});

test('a user switch during import is shared instead of being replaced by the remote selection', async t => {
  const f = await fixture(t, [account('one'), { ...account('two'), active: false }]);
  const a = f.worker(); await a.bridge.sync();
  const saved = await f.saved(); saved[0].label = 'Remote rename';
  await writeCredentials(f.path, saved);
  const update = a.api.update;
  a.api.update = async (...args) => { await update(...args); await a.api.activate('cred_two'); };
  await a.bridge.sync(); a.restart(); await a.bridge.sync();
  assert.equal((await f.saved()).find(item => item.active).id, 'cred_two');
});

test('a login while importing a remote account takes precedence over its active selection', async t => {
  const f = await fixture(t);
  const a = f.worker(); await a.bridge.sync();
  const saved = await f.saved(); saved[0].active = false;
  await writeCredentials(f.path, [...saved, account('remote')]);
  const create = a.api.create;
  a.api.create = async item => { await create(item); await create(account('during-import')); };
  await a.bridge.sync();
  assert.equal(a.database.find(item => item.active).id, 'cred_during-import');
  a.restart(); await a.bridge.sync();
  assert.deepEqual(ids(await f.saved()), ['cred_during-import', 'cred_one', 'cred_remote']);
  assert.equal((await f.saved()).find(item => item.active).id, 'cred_during-import');
});

test('a failed import and restart do not publish the automatic fallback after deleting an active account', async t => {
  const f = await fixture(t, [account('one'), { ...account('two'), active: false },
    { ...account('three'), active: false }]);
  const a = f.worker(), b = f.worker();
  await a.bridge.sync(); await b.bridge.sync();
  await b.api.activate('cred_two'); await b.disconnect('cred_one');
  b.database.find(item => item.id === 'cred_two').label = 'Remote rename';
  await b.bridge.sync();
  const update = a.api.update;
  a.api.update = async () => { throw new Error('Temporary PATCH failure'); };
  await assert.rejects(a.bridge.sync(), /Temporary PATCH failure/);
  a.api.update = update;
  a.restart(); await a.bridge.sync(); await b.bridge.sync();
  assert.deepEqual(ids(await f.saved()), ['cred_three', 'cred_two']);
  assert.equal((await f.saved()).find(item => item.active).id, 'cred_two');
  assert.equal(a.database.find(item => item.active).id, 'cred_two');
  assert.equal(b.database.find(item => item.active).id, 'cred_two');
});
