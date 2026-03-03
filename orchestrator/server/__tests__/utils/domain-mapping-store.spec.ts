import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DomainMappingStore, type DomainMapping } from '../../utils/domain-mapping-store';

let tempDir: string;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

async function makeTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), 'domain-mapping-test-'));
  return tempDir;
}

let idCounter = 0;

function makeMapping(overrides: Partial<DomainMapping> = {}): DomainMapping {
  idCounter++;
  return {
    id: `dm-${idCounter}`,
    subdomain: 'app',
    baseDomain: 'example.com',
    protocol: 'https',
    workerId: 'worker-1',
    workerName: 'test-worker',
    internalPort: 3000,
    ...overrides,
  };
}

describe('DomainMappingStore', () => {
  it('add() stores mapping and persists', async () => {
    const dir = await makeTempDir();
    const store = new DomainMappingStore(dir);
    await store.init();
    const mapping = makeMapping({ id: 'test-1' });
    await store.add(mapping);
    expect(store.get('test-1')).toEqual(mapping);
    expect(store.list()).toHaveLength(1);
  });

  it('add() same subdomain+baseDomain+protocol throws', async () => {
    const dir = await makeTempDir();
    const store = new DomainMappingStore(dir);
    await store.init();
    await store.add(makeMapping({ id: 'a', subdomain: 'api', baseDomain: 'test.com', protocol: 'https' }));
    await expect(
      store.add(makeMapping({ id: 'b', subdomain: 'api', baseDomain: 'test.com', protocol: 'https' })),
    ).rejects.toThrow("'api.test.com' is already mapped for protocol 'https'");
  });

  it('add() HTTPS + TCP on same subdomain+baseDomain throws', async () => {
    const dir = await makeTempDir();
    const store = new DomainMappingStore(dir);
    await store.init();
    await store.add(makeMapping({ id: 'h1', subdomain: 'db', baseDomain: 'test.com', protocol: 'https' }));
    await expect(
      store.add(makeMapping({ id: 'h2', subdomain: 'db', baseDomain: 'test.com', protocol: 'tcp' })),
    ).rejects.toThrow("'db.test.com' cannot have both HTTPS and TCP mappings (both use port 443)");
  });

  it('add() TCP + HTTPS on same subdomain+baseDomain also throws (reverse order)', async () => {
    const dir = await makeTempDir();
    const store = new DomainMappingStore(dir);
    await store.init();
    await store.add(makeMapping({ id: 't1', subdomain: 'db', baseDomain: 'test.com', protocol: 'tcp' }));
    await expect(
      store.add(makeMapping({ id: 't2', subdomain: 'db', baseDomain: 'test.com', protocol: 'https' })),
    ).rejects.toThrow("'db.test.com' cannot have both HTTPS and TCP mappings (both use port 443)");
  });

  it('add() HTTP + TCP on same subdomain is allowed (different ports)', async () => {
    const dir = await makeTempDir();
    const store = new DomainMappingStore(dir);
    await store.init();
    await store.add(makeMapping({ id: 'ht1', subdomain: 'mix', baseDomain: 'test.com', protocol: 'http' }));
    await store.add(makeMapping({ id: 'ht2', subdomain: 'mix', baseDomain: 'test.com', protocol: 'tcp' }));
    expect(store.list()).toHaveLength(2);
  });

  it('add() same subdomain on different baseDomains is allowed', async () => {
    const dir = await makeTempDir();
    const store = new DomainMappingStore(dir);
    await store.init();
    await store.add(makeMapping({ id: 'd1', subdomain: 'app', baseDomain: 'foo.com', protocol: 'https' }));
    await store.add(makeMapping({ id: 'd2', subdomain: 'app', baseDomain: 'bar.com', protocol: 'https' }));
    expect(store.list()).toHaveLength(2);
  });

  it('add() same baseDomain with different subdomains is allowed', async () => {
    const dir = await makeTempDir();
    const store = new DomainMappingStore(dir);
    await store.init();
    await store.add(makeMapping({ id: 's1', subdomain: 'api', baseDomain: 'test.com', protocol: 'https' }));
    await store.add(makeMapping({ id: 's2', subdomain: 'web', baseDomain: 'test.com', protocol: 'https' }));
    expect(store.list()).toHaveLength(2);
  });

  it('remove() deletes and returns true', async () => {
    const dir = await makeTempDir();
    const store = new DomainMappingStore(dir);
    await store.init();
    await store.add(makeMapping({ id: 'rm-1' }));
    const result = await store.remove('rm-1');
    expect(result).toBe(true);
    expect(store.get('rm-1')).toBeUndefined();
  });

  it('remove() non-existent returns false', async () => {
    const dir = await makeTempDir();
    const store = new DomainMappingStore(dir);
    await store.init();
    const result = await store.remove('does-not-exist');
    expect(result).toBe(false);
  });

  it('removeForWorker() removes all for worker', async () => {
    const dir = await makeTempDir();
    const store = new DomainMappingStore(dir);
    await store.init();
    await store.add(makeMapping({ id: 'fw1', workerId: 'w1', subdomain: 'a' }));
    await store.add(makeMapping({ id: 'fw2', workerId: 'w1', subdomain: 'b' }));
    await store.add(makeMapping({ id: 'fw3', workerId: 'w2', subdomain: 'c' }));
    const removed = await store.removeForWorker('w1');
    expect(removed).toBe(2);
    expect(store.list()).toHaveLength(1);
    expect(store.get('fw3')).toBeDefined();
  });

  it('cleanupStaleWorkers() removes stale workers', async () => {
    const dir = await makeTempDir();
    const store = new DomainMappingStore(dir);
    await store.init();
    await store.add(makeMapping({ id: 'cw1', workerId: 'active', subdomain: 'x' }));
    await store.add(makeMapping({ id: 'cw2', workerId: 'stale', subdomain: 'y' }));
    const removed = await store.cleanupStaleWorkers(new Set(['active']));
    expect(removed).toBe(1);
    expect(store.list()).toHaveLength(1);
    expect(store.get('cw1')?.workerId).toBe('active');
  });

  it('list() returns all mappings', async () => {
    const dir = await makeTempDir();
    const store = new DomainMappingStore(dir);
    await store.init();
    await store.add(makeMapping({ id: 'l1', subdomain: 'one' }));
    await store.add(makeMapping({ id: 'l2', subdomain: 'two' }));
    await store.add(makeMapping({ id: 'l3', subdomain: 'three' }));
    expect(store.list()).toHaveLength(3);
  });
});
