import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PortMappingStore, type PortMapping } from '../../utils/port-mapping-store';

let tempDir: string;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

async function makeTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), 'port-mapping-test-'));
  return tempDir;
}

function makeMapping(overrides: Partial<PortMapping> = {}): PortMapping {
  return {
    externalPort: 8080,
    type: 'localhost',
    workerId: 'worker-1',
    workerName: 'test-worker',
    internalPort: 3000,
    ...overrides,
  };
}

describe('PortMappingStore', () => {
  it('constructor creates store with correct file name', async () => {
    const dir = await makeTempDir();
    const store = new PortMappingStore(dir);
    await store.init();
    await store.add(makeMapping());
    const content = await readFile(join(dir, 'port-mappings.json'), 'utf-8');
    expect(JSON.parse(content)).toHaveLength(1);
  });

  it('add() stores mapping and persists', async () => {
    const dir = await makeTempDir();
    const store = new PortMappingStore(dir);
    await store.init();
    const mapping = makeMapping({ externalPort: 9000 });
    await store.add(mapping);
    expect(store.get(9000)).toEqual(mapping);
    const content = await readFile(join(dir, 'port-mappings.json'), 'utf-8');
    expect(JSON.parse(content)).toContainEqual(mapping);
  });

  it('add() duplicate port throws error', async () => {
    const dir = await makeTempDir();
    const store = new PortMappingStore(dir);
    await store.init();
    await store.add(makeMapping({ externalPort: 5000 }));
    await expect(store.add(makeMapping({ externalPort: 5000 }))).rejects.toThrow(
      'Port 5000 is already mapped',
    );
  });

  it('remove() deletes existing mapping, returns true', async () => {
    const dir = await makeTempDir();
    const store = new PortMappingStore(dir);
    await store.init();
    await store.add(makeMapping({ externalPort: 7000 }));
    const result = await store.remove(7000);
    expect(result).toBe(true);
    expect(store.get(7000)).toBeUndefined();
  });

  it('remove() non-existent returns false', async () => {
    const dir = await makeTempDir();
    const store = new PortMappingStore(dir);
    await store.init();
    const result = await store.remove(9999);
    expect(result).toBe(false);
  });

  it('removeForWorker() removes all for a specific worker', async () => {
    const dir = await makeTempDir();
    const store = new PortMappingStore(dir);
    await store.init();
    await store.add(makeMapping({ externalPort: 1001, workerId: 'w1' }));
    await store.add(makeMapping({ externalPort: 1002, workerId: 'w1' }));
    await store.add(makeMapping({ externalPort: 1003, workerId: 'w2' }));
    const removed = await store.removeForWorker('w1');
    expect(removed).toBe(2);
    expect(store.list()).toHaveLength(1);
    expect(store.get(1003)).toBeDefined();
  });

  it('removeForWorker() returns count of removed', async () => {
    const dir = await makeTempDir();
    const store = new PortMappingStore(dir);
    await store.init();
    await store.add(makeMapping({ externalPort: 2001, workerId: 'w1' }));
    const removed = await store.removeForWorker('w-none');
    expect(removed).toBe(0);
  });

  it('cleanupStaleWorkers() removes workers not in active set', async () => {
    const dir = await makeTempDir();
    const store = new PortMappingStore(dir);
    await store.init();
    await store.add(makeMapping({ externalPort: 3001, workerId: 'active' }));
    await store.add(makeMapping({ externalPort: 3002, workerId: 'stale' }));
    await store.add(makeMapping({ externalPort: 3003, workerId: 'gone' }));
    const removed = await store.cleanupStaleWorkers(new Set(['active']));
    expect(removed).toBe(2);
    expect(store.list()).toHaveLength(1);
    expect(store.get(3001)?.workerId).toBe('active');
  });

  it('list() returns all mappings', async () => {
    const dir = await makeTempDir();
    const store = new PortMappingStore(dir);
    await store.init();
    await store.add(makeMapping({ externalPort: 4001 }));
    await store.add(makeMapping({ externalPort: 4002 }));
    expect(store.list()).toHaveLength(2);
  });

  it('persists across init() reload', async () => {
    const dir = await makeTempDir();
    const store1 = new PortMappingStore(dir);
    await store1.init();
    await store1.add(makeMapping({ externalPort: 5001, workerName: 'reloaded' }));
    await store1.add(makeMapping({ externalPort: 5002 }));

    const store2 = new PortMappingStore(dir);
    await store2.init();
    expect(store2.list()).toHaveLength(2);
    expect(store2.get(5001)?.workerName).toBe('reloaded');
  });
});
