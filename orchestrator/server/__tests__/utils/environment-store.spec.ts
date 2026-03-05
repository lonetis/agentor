import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EnvironmentStore, type Environment } from '../../utils/environments';

let tempDir: string;

beforeEach(() => {
  // EnvironmentStore imports loadConfig (via getPackageManagerDomains at module level),
  // stub all env vars to avoid side effects
  vi.stubEnv('GITHUB_TOKEN', '');
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('GEMINI_API_KEY', '');
  vi.stubEnv('DOCKER_NETWORK', '');
  vi.stubEnv('CONTAINER_PREFIX', '');
  vi.stubEnv('DEFAULT_CPU_LIMIT', '');
  vi.stubEnv('DEFAULT_MEMORY_LIMIT', '');
  vi.stubEnv('WORKER_IMAGE', '');
  vi.stubEnv('MAPPER_IMAGE', '');
  vi.stubEnv('DATA_VOLUME', '');
  vi.stubEnv('ORCHESTRATOR_IMAGE', '');
  vi.stubEnv('WORKER_IMAGE_PREFIX', '');
  vi.stubEnv('PACKAGE_MANAGER_DOMAINS', '');
  vi.stubEnv('DATA_DIR', '');
  vi.stubEnv('BASE_DOMAINS', '');
  vi.stubEnv('DASHBOARD_BASE_DOMAIN', '');
  vi.stubEnv('DASHBOARD_SUBDOMAIN', '');
  vi.stubEnv('ACME_EMAIL', '');
  vi.stubEnv('TRAEFIK_IMAGE', '');
  vi.stubEnv('DASHBOARD_AUTH_USER', '');
  vi.stubEnv('DASHBOARD_AUTH_PASSWORD', '');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

async function makeTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), 'env-store-test-'));
  return tempDir;
}

type EnvInput = Omit<Environment, 'id' | 'createdAt' | 'updatedAt'>;

function makeEnvInput(overrides: Partial<EnvInput> = {}): EnvInput {
  return {
    name: 'Test Env',
    cpuLimit: 2,
    memoryLimit: '4g',
    networkMode: 'full',
    allowedDomains: [],
    includePackageManagerDomains: false,
    dockerEnabled: false,
    envVars: '',
    setupScript: '',
    initScript: '',
    ...overrides,
  };
}

describe('EnvironmentStore', () => {
  it('list() returns empty for new store', async () => {
    const dir = await makeTempDir();
    const store = new EnvironmentStore(dir);
    await store.init();
    expect(store.list()).toEqual([]);
  });

  it('create() generates id, createdAt, updatedAt', async () => {
    const dir = await makeTempDir();
    const store = new EnvironmentStore(dir);
    await store.init();
    const env = await store.create(makeEnvInput({ name: 'My Env' }));
    expect(env.id).toBeDefined();
    expect(env.id.length).toBe(12);
    expect(env.createdAt).toBeDefined();
    expect(env.updatedAt).toBeDefined();
    expect(env.name).toBe('My Env');
  });

  it('create() stores environment', async () => {
    const dir = await makeTempDir();
    const store = new EnvironmentStore(dir);
    await store.init();
    const env = await store.create(makeEnvInput());
    expect(store.get(env.id)).toEqual(env);
    expect(store.list()).toHaveLength(1);
  });

  it('list() returns sorted by name', async () => {
    const dir = await makeTempDir();
    const store = new EnvironmentStore(dir);
    await store.init();
    await store.create(makeEnvInput({ name: 'Zulu' }));
    await store.create(makeEnvInput({ name: 'Alpha' }));
    await store.create(makeEnvInput({ name: 'Mike' }));
    const names = store.list().map((e) => e.name);
    expect(names).toEqual(['Alpha', 'Mike', 'Zulu']);
  });

  it('update() merges data, preserves id and createdAt, updates updatedAt', async () => {
    const dir = await makeTempDir();
    const store = new EnvironmentStore(dir);
    await store.init();
    const env = await store.create(makeEnvInput({ name: 'Original', cpuLimit: 1 }));
    const originalCreatedAt = env.createdAt;

    // small delay to ensure updatedAt changes
    await new Promise((r) => setTimeout(r, 10));

    const updated = await store.update(env.id, { name: 'Renamed', cpuLimit: 4 });
    expect(updated.id).toBe(env.id);
    expect(updated.createdAt).toBe(originalCreatedAt);
    expect(updated.name).toBe('Renamed');
    expect(updated.cpuLimit).toBe(4);
    expect(updated.updatedAt).not.toBe(env.updatedAt);
  });

  it('update() throws for non-existent id', async () => {
    const dir = await makeTempDir();
    const store = new EnvironmentStore(dir);
    await store.init();
    await expect(store.update('bad-id', { name: 'X' })).rejects.toThrow(
      'Environment not found: bad-id',
    );
  });

  it('delete() removes environment', async () => {
    const dir = await makeTempDir();
    const store = new EnvironmentStore(dir);
    await store.init();
    const env = await store.create(makeEnvInput());
    await store.delete(env.id);
    expect(store.get(env.id)).toBeUndefined();
    expect(store.list()).toHaveLength(0);
  });

  it('delete() throws for non-existent id', async () => {
    const dir = await makeTempDir();
    const store = new EnvironmentStore(dir);
    await store.init();
    await expect(store.delete('nope')).rejects.toThrow('Environment not found: nope');
  });

  it('get() returns single environment', async () => {
    const dir = await makeTempDir();
    const store = new EnvironmentStore(dir);
    await store.init();
    const env = await store.create(makeEnvInput({ name: 'Findable' }));
    const found = store.get(env.id);
    expect(found?.name).toBe('Findable');
  });

  it('get() returns undefined for missing id', async () => {
    const dir = await makeTempDir();
    const store = new EnvironmentStore(dir);
    await store.init();
    expect(store.get('does-not-exist')).toBeUndefined();
  });

  it('multiple creates generate unique ids', async () => {
    const dir = await makeTempDir();
    const store = new EnvironmentStore(dir);
    await store.init();
    const ids = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const env = await store.create(makeEnvInput({ name: `env-${i}` }));
      ids.add(env.id);
    }
    expect(ids.size).toBe(10);
  });

  it('persists across init() reload', async () => {
    const dir = await makeTempDir();
    const store1 = new EnvironmentStore(dir);
    await store1.init();
    const env = await store1.create(makeEnvInput({ name: 'Persistent' }));

    const store2 = new EnvironmentStore(dir);
    await store2.init();
    expect(store2.list()).toHaveLength(1);
    expect(store2.get(env.id)?.name).toBe('Persistent');
  });
});
