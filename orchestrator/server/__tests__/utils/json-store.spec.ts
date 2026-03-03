import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../../utils/json-store';

interface TestItem {
  id: string;
  value: string;
}

class TestStore extends JsonStore<string, TestItem> {
  constructor(dir: string) {
    super(dir, 'test.json', (item) => item.id);
  }
  async addItem(item: TestItem) {
    this.items.set(item.id, item);
    await this.persist();
  }
  async removeById(id: string) {
    return this.removeWhere((item) => item.id === id);
  }
}

let tempDir: string;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

async function makeTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), 'json-store-test-'));
  return tempDir;
}

describe('JsonStore', () => {
  it('init() with no file (ENOENT) creates empty store', async () => {
    const dir = await makeTempDir();
    const store = new TestStore(dir);
    await store.init();
    expect(store.list()).toEqual([]);
  });

  it('init() with existing file loads items', async () => {
    const dir = await makeTempDir();
    const items: TestItem[] = [
      { id: 'a', value: 'alpha' },
      { id: 'b', value: 'beta' },
    ];
    await writeFile(join(dir, 'test.json'), JSON.stringify(items));
    const store = new TestStore(dir);
    await store.init();
    expect(store.list()).toHaveLength(2);
    expect(store.get('a')).toEqual({ id: 'a', value: 'alpha' });
    expect(store.get('b')).toEqual({ id: 'b', value: 'beta' });
  });

  it('init() with corrupt JSON throws', async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, 'test.json'), 'not valid json {{{');
    const store = new TestStore(dir);
    await expect(store.init()).rejects.toThrow();
  });

  it('list() returns all items', async () => {
    const dir = await makeTempDir();
    const store = new TestStore(dir);
    await store.init();
    await store.addItem({ id: 'x', value: 'x-val' });
    await store.addItem({ id: 'y', value: 'y-val' });
    const all = store.list();
    expect(all).toHaveLength(2);
    expect(all.map((i) => i.id).sort()).toEqual(['x', 'y']);
  });

  it('get() returns item by key', async () => {
    const dir = await makeTempDir();
    const store = new TestStore(dir);
    await store.init();
    await store.addItem({ id: 'k1', value: 'val1' });
    expect(store.get('k1')).toEqual({ id: 'k1', value: 'val1' });
  });

  it('get() returns undefined for missing key', async () => {
    const dir = await makeTempDir();
    const store = new TestStore(dir);
    await store.init();
    expect(store.get('nonexistent')).toBeUndefined();
  });

  it('has() returns true for existing key', async () => {
    const dir = await makeTempDir();
    const store = new TestStore(dir);
    await store.init();
    await store.addItem({ id: 'exists', value: 'yes' });
    expect(store.has('exists')).toBe(true);
  });

  it('has() returns false for missing key', async () => {
    const dir = await makeTempDir();
    const store = new TestStore(dir);
    await store.init();
    expect(store.has('nope')).toBe(false);
  });

  it('persist() creates directory if missing', async () => {
    const dir = await makeTempDir();
    const nestedDir = join(dir, 'sub', 'deep');
    const store = new TestStore(nestedDir);
    await store.init();
    await store.addItem({ id: 'nested', value: 'deep' });
    const content = await readFile(join(nestedDir, 'test.json'), 'utf-8');
    expect(JSON.parse(content)).toEqual([{ id: 'nested', value: 'deep' }]);
  });

  it('persist() writes JSON array to file', async () => {
    const dir = await makeTempDir();
    const store = new TestStore(dir);
    await store.init();
    await store.addItem({ id: 'a', value: '1' });
    await store.addItem({ id: 'b', value: '2' });
    const content = await readFile(join(dir, 'test.json'), 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed).toHaveLength(2);
    expect(parsed).toContainEqual({ id: 'a', value: '1' });
    expect(parsed).toContainEqual({ id: 'b', value: '2' });
  });

  it('removeWhere() removes matching items and persists', async () => {
    const dir = await makeTempDir();
    const store = new TestStore(dir);
    await store.init();
    await store.addItem({ id: 'keep', value: 'stay' });
    await store.addItem({ id: 'remove', value: 'go' });
    const removed = await store.removeById('remove');
    expect(removed).toBe(1);
    expect(store.list()).toHaveLength(1);
    expect(store.get('remove')).toBeUndefined();
    expect(store.get('keep')).toBeDefined();
    // verify persisted
    const content = await readFile(join(dir, 'test.json'), 'utf-8');
    expect(JSON.parse(content)).toHaveLength(1);
  });

  it('removeWhere() with no matches does not persist (file unchanged)', async () => {
    const dir = await makeTempDir();
    const store = new TestStore(dir);
    await store.init();
    await store.addItem({ id: 'only', value: 'one' });
    // read file content before
    const before = await readFile(join(dir, 'test.json'), 'utf-8');
    const removed = await store.removeById('nonexistent');
    expect(removed).toBe(0);
    // file should be identical (no write happened)
    const after = await readFile(join(dir, 'test.json'), 'utf-8');
    expect(after).toBe(before);
  });

  it('multiple persist() calls are serialized via saveQueue', async () => {
    const dir = await makeTempDir();
    const store = new TestStore(dir);
    await store.init();
    // fire multiple adds without awaiting individually
    const promises = [
      store.addItem({ id: '1', value: 'a' }),
      store.addItem({ id: '2', value: 'b' }),
      store.addItem({ id: '3', value: 'c' }),
    ];
    await Promise.all(promises);
    // all items should be present
    expect(store.list()).toHaveLength(3);
    // file should contain all items
    const content = await readFile(join(dir, 'test.json'), 'utf-8');
    expect(JSON.parse(content)).toHaveLength(3);
  });

  it('items map is populated correctly after init', async () => {
    const dir = await makeTempDir();
    const items: TestItem[] = [
      { id: 'first', value: 'one' },
      { id: 'second', value: 'two' },
      { id: 'third', value: 'three' },
    ];
    await writeFile(join(dir, 'test.json'), JSON.stringify(items));
    const store = new TestStore(dir);
    await store.init();
    expect(store.has('first')).toBe(true);
    expect(store.has('second')).toBe(true);
    expect(store.has('third')).toBe(true);
    expect(store.has('fourth')).toBe(false);
    expect(store.list()).toHaveLength(3);
  });
});
