import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkerStore, type WorkerRecord } from '../../utils/worker-store';

let tempDir: string;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

async function makeTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), 'worker-store-test-'));
  return tempDir;
}

function makeWorker(overrides: Partial<WorkerRecord> = {}): WorkerRecord {
  return {
    id: 'container-abc',
    name: 'test-worker',
    image: 'agentor-worker:latest',
    imageId: 'sha256:abc',
    labels: { 'agentor.managed': 'true' },
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('WorkerStore', () => {
  it('list() returns empty for new store', async () => {
    const dir = await makeTempDir();
    const store = new WorkerStore(dir);
    await store.init();
    expect(store.list()).toEqual([]);
  });

  it('list() returns sorted by name', async () => {
    const dir = await makeTempDir();
    const store = new WorkerStore(dir);
    await store.init();
    await store.upsert(makeWorker({ name: 'charlie' }));
    await store.upsert(makeWorker({ name: 'alpha' }));
    await store.upsert(makeWorker({ name: 'bravo' }));
    const names = store.list().map((w) => w.name);
    expect(names).toEqual(['alpha', 'bravo', 'charlie']);
  });

  it('listArchived() returns only archived workers', async () => {
    const dir = await makeTempDir();
    const store = new WorkerStore(dir);
    await store.init();
    await store.upsert(makeWorker({ name: 'active-1', status: 'active' }));
    await store.upsert(makeWorker({ name: 'archived-1', status: 'archived' }));
    await store.upsert(makeWorker({ name: 'archived-2', status: 'archived' }));
    const archived = store.listArchived();
    expect(archived).toHaveLength(2);
    expect(archived.every((w) => w.status === 'archived')).toBe(true);
  });

  it('listActive() returns only active workers', async () => {
    const dir = await makeTempDir();
    const store = new WorkerStore(dir);
    await store.init();
    await store.upsert(makeWorker({ name: 'active-1', status: 'active' }));
    await store.upsert(makeWorker({ name: 'active-2', status: 'active' }));
    await store.upsert(makeWorker({ name: 'archived-1', status: 'archived' }));
    const active = store.listActive();
    expect(active).toHaveLength(2);
    expect(active.every((w) => w.status === 'active')).toBe(true);
  });

  it('upsert() adds new worker', async () => {
    const dir = await makeTempDir();
    const store = new WorkerStore(dir);
    await store.init();
    await store.upsert(makeWorker({ name: 'new-worker' }));
    expect(store.get('new-worker')).toBeDefined();
    expect(store.list()).toHaveLength(1);
  });

  it('upsert() updates existing worker', async () => {
    const dir = await makeTempDir();
    const store = new WorkerStore(dir);
    await store.init();
    await store.upsert(makeWorker({ name: 'worker-1', displayName: 'Old Name' }));
    await store.upsert(makeWorker({ name: 'worker-1', displayName: 'New Name' }));
    expect(store.list()).toHaveLength(1);
    expect(store.get('worker-1')?.displayName).toBe('New Name');
  });

  it('archive() sets status=archived, archivedAt, clears id', async () => {
    const dir = await makeTempDir();
    const store = new WorkerStore(dir);
    await store.init();
    await store.upsert(makeWorker({ name: 'to-archive', id: 'container-xyz' }));
    await store.archive('to-archive');
    const worker = store.get('to-archive');
    expect(worker?.status).toBe('archived');
    expect(worker?.archivedAt).toBeDefined();
    expect(worker?.id).toBe('');
  });

  it('archive() throws for non-existent worker', async () => {
    const dir = await makeTempDir();
    const store = new WorkerStore(dir);
    await store.init();
    await expect(store.archive('ghost')).rejects.toThrow('Worker not found: ghost');
  });

  it('unarchive() sets status=active, new containerId, clears archivedAt', async () => {
    const dir = await makeTempDir();
    const store = new WorkerStore(dir);
    await store.init();
    await store.upsert(
      makeWorker({ name: 'revive', status: 'archived', archivedAt: '2026-01-01T00:00:00Z', id: '' }),
    );
    await store.unarchive('revive', 'new-container-id');
    const worker = store.get('revive');
    expect(worker?.status).toBe('active');
    expect(worker?.id).toBe('new-container-id');
    expect(worker?.archivedAt).toBeUndefined();
  });

  it('unarchive() throws for non-existent worker', async () => {
    const dir = await makeTempDir();
    const store = new WorkerStore(dir);
    await store.init();
    await expect(store.unarchive('missing', 'id')).rejects.toThrow('Worker not found: missing');
  });

  it('delete() removes worker', async () => {
    const dir = await makeTempDir();
    const store = new WorkerStore(dir);
    await store.init();
    await store.upsert(makeWorker({ name: 'to-delete' }));
    await store.delete('to-delete');
    expect(store.get('to-delete')).toBeUndefined();
    expect(store.list()).toHaveLength(0);
  });

  it('delete() throws for non-existent worker', async () => {
    const dir = await makeTempDir();
    const store = new WorkerStore(dir);
    await store.init();
    await expect(store.delete('nope')).rejects.toThrow('Worker not found: nope');
  });

  it('persists across init() reload', async () => {
    const dir = await makeTempDir();
    const store1 = new WorkerStore(dir);
    await store1.init();
    await store1.upsert(makeWorker({ name: 'persistent', displayName: 'Survives' }));

    const store2 = new WorkerStore(dir);
    await store2.init();
    expect(store2.list()).toHaveLength(1);
    expect(store2.get('persistent')?.displayName).toBe('Survives');
  });

  it('mixed active/archived filtering works correctly', async () => {
    const dir = await makeTempDir();
    const store = new WorkerStore(dir);
    await store.init();
    await store.upsert(makeWorker({ name: 'a1', status: 'active' }));
    await store.upsert(makeWorker({ name: 'a2', status: 'active' }));
    await store.upsert(makeWorker({ name: 'r1', status: 'archived' }));
    await store.upsert(makeWorker({ name: 'r2', status: 'archived' }));
    await store.upsert(makeWorker({ name: 'r3', status: 'archived' }));
    expect(store.list()).toHaveLength(5);
    expect(store.listActive()).toHaveLength(2);
    expect(store.listArchived()).toHaveLength(3);
  });
});
