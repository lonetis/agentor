import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Config } from '../../utils/config';
import type { ContainerInfo, NetworkMode } from '../../../shared/types';

// Mock external dependencies used by container.ts
vi.mock('../../utils/git-providers', () => ({
  getAllGitCloneDomains: vi.fn(() => ['github.com']),
  listGitProviders: vi.fn(() => []),
}));

vi.mock('../../utils/environments', () => ({
  getPackageManagerDomains: vi.fn(() => ['registry.npmjs.org', 'pypi.org']),
}));

vi.mock('../../utils/agent-config', () => ({
  getAllAgentApiDomains: vi.fn(() => ['api.anthropic.com', 'api.openai.com']),
  getAllAgentEnvVars: vi.fn(() => []),
}));

vi.mock('../../utils/apps', () => ({
  getAppType: vi.fn((id: string) => {
    if (id === 'chromium') {
      return {
        id: 'chromium',
        displayName: 'Chromium',
        ports: [{ id: 'cdp', name: 'CDP', internalPortStart: 9222, internalPortEnd: 9322 }],
        maxInstances: 10,
        manageScript: 'chromium/manage.sh',
      };
    }
    return undefined;
  }),
}));

import { ContainerManager } from '../../utils/container';
import type { DockerService } from '../../utils/docker';
import type { EnvironmentStore, Environment } from '../../utils/environments';
import type { WorkerStore, WorkerRecord } from '../../utils/worker-store';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    githubToken: '',
    anthropicApiKey: '',
    openaiApiKey: '',
    geminiApiKey: '',
    dockerNetwork: 'agentor-net',
    containerPrefix: 'agentor-worker',
    defaultCpuLimit: 0,
    defaultMemoryLimit: '',
    workerImage: 'agentor-worker:latest',
    mapperImage: 'agentor-mapper:latest',
    dataVolume: './data',
    orchestratorImage: 'agentor-orchestrator:latest',
    workerImagePrefix: '',
    packageManagerDomains: [],
    dataDir: '/data',
    baseDomains: [],
    dashboardBaseDomain: '',
    dashboardSubdomain: '',
    acmeEmail: '',
    traefikImage: 'traefik:v3',
    dashboardAuthUser: '',
    dashboardAuthPassword: '',
    baseDomainConfigs: [],
    dnsProviderConfigs: {},
    ...overrides,
  };
}

function makeMockDockerService() {
  return {
    createWorkerContainer: vi.fn().mockResolvedValue({ id: 'new-container-id', start: vi.fn() }),
    listContainers: vi.fn().mockResolvedValue([]),
    stopContainer: vi.fn().mockResolvedValue(undefined),
    restartContainer: vi.fn().mockResolvedValue(undefined),
    removeContainer: vi.fn().mockResolvedValue(undefined),
    removeVolume: vi.fn().mockResolvedValue(undefined),
    getLogs: vi.fn().mockResolvedValue('log output'),
    execListTmuxWindows: vi.fn().mockResolvedValue([]),
    execTmux: vi.fn().mockResolvedValue(undefined),
    listAppInstances: vi.fn().mockResolvedValue([]),
    startAppInstance: vi.fn().mockResolvedValue('ok'),
    stopAppInstance: vi.fn().mockResolvedValue(undefined),
    putWorkspaceArchive: vi.fn().mockResolvedValue(undefined),
    getWorkspaceArchive: vi.fn().mockResolvedValue({}),
  } as unknown as DockerService;
}

function makeMockEnvironmentStore(envs: Record<string, Partial<Environment>> = {}) {
  return {
    get: vi.fn((id: string) => envs[id] ?? undefined),
  } as unknown as EnvironmentStore;
}

function makeMockWorkerStore() {
  const items = new Map<string, WorkerRecord>();
  return {
    get: vi.fn((name: string) => items.get(name)),
    upsert: vi.fn(async (record: WorkerRecord) => { items.set(record.name, record); }),
    archive: vi.fn(async (name: string) => {
      const w = items.get(name);
      if (w) w.status = 'archived';
    }),
    unarchive: vi.fn(async (name: string, newId: string) => {
      const w = items.get(name);
      if (w) { w.status = 'active'; w.id = newId; }
    }),
    delete: vi.fn(async () => {}),
    listArchived: vi.fn(() => Array.from(items.values()).filter((w) => w.status === 'archived')),
    listActive: vi.fn(() => Array.from(items.values()).filter((w) => w.status === 'active')),
    _items: items,
  } as unknown as WorkerStore & { _items: Map<string, WorkerRecord> };
}

describe('ContainerManager', () => {
  let dockerService: ReturnType<typeof makeMockDockerService>;
  let manager: ContainerManager;
  let config: Config;

  beforeEach(() => {
    vi.clearAllMocks();
    config = makeConfig();
    dockerService = makeMockDockerService();
    manager = new ContainerManager(dockerService as unknown as DockerService, config);
  });

  describe('STATE_MAP (tested via sync)', () => {
    it('maps Docker states to ContainerStatus', async () => {
      (dockerService.listContainers as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { Id: '1', Names: ['/running-1'], State: 'running', Image: 'img', ImageID: 'imgid', Labels: { 'agentor.managed': 'true', 'agentor.created': '2024-01-01' } },
        { Id: '2', Names: ['/stopped-1'], State: 'exited', Image: 'img', ImageID: 'imgid', Labels: { 'agentor.managed': 'true', 'agentor.created': '2024-01-01' } },
        { Id: '3', Names: ['/creating-1'], State: 'created', Image: 'img', ImageID: 'imgid', Labels: { 'agentor.managed': 'true', 'agentor.created': '2024-01-01' } },
        { Id: '4', Names: ['/dead-1'], State: 'dead', Image: 'img', ImageID: 'imgid', Labels: { 'agentor.managed': 'true', 'agentor.created': '2024-01-01' } },
      ]);

      await manager.sync();
      expect(manager.get('1')!.status).toBe('running');
      expect(manager.get('2')!.status).toBe('stopped');
      expect(manager.get('3')!.status).toBe('creating');
      expect(manager.get('4')!.status).toBe('error');
    });
  });

  describe('generateName', () => {
    it('returns containerPrefix + adjective-animal name', () => {
      const name = manager.generateName();
      expect(name).toMatch(/^agentor-worker-[a-z]+-[a-z]+$/);
    });
  });

  describe('sync', () => {
    it('populates containers from Docker labels', async () => {
      (dockerService.listContainers as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        {
          Id: 'abc123',
          Names: ['/my-worker'],
          State: 'running',
          Image: 'agentor-worker:latest',
          ImageID: 'sha256:abc',
          Labels: {
            'agentor.managed': 'true',
            'agentor.created': '2024-01-01T00:00:00Z',
            'agentor.display-name': 'Test Worker',
          },
        },
      ]);

      await manager.sync();
      const info = manager.get('abc123');
      expect(info).toBeDefined();
      expect(info!.name).toBe('my-worker');
      expect(info!.displayName).toBe('Test Worker');
      expect(info!.status).toBe('running');
    });

    it('parses agentor.repos JSON label', async () => {
      const repos = [{ provider: 'github', url: 'https://github.com/test/repo' }];
      (dockerService.listContainers as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        {
          Id: 'abc',
          Names: ['/worker'],
          State: 'running',
          Image: 'img',
          ImageID: 'imgid',
          Labels: {
            'agentor.managed': 'true',
            'agentor.created': '2024-01-01',
            'agentor.repos': JSON.stringify(repos),
          },
        },
      ]);

      await manager.sync();
      expect(manager.get('abc')!.repos).toEqual(repos);
    });
  });

  describe('resolveEnvironmentConfig (via create)', () => {
    it('block-all does not add API domains', async () => {
      const envStore = makeMockEnvironmentStore({
        'env-1': {
          id: 'env-1',
          name: 'Blocked',
          networkMode: 'block-all' as NetworkMode,
          allowedDomains: [],
          includePackageManagerDomains: false,
          dockerEnabled: true,
          envVars: '',
          setupScript: '',
          cpuLimit: 0,
          memoryLimit: '',
        },
      });
      manager.setEnvironmentStore(envStore);
      const workerStore = makeMockWorkerStore();
      manager.setWorkerStore(workerStore as any);

      await manager.create({ environmentId: 'env-1' });
      const call = (dockerService.createWorkerContainer as ReturnType<typeof vi.fn>).mock.calls[0][0];
      // block-all should not have allowedDomains
      expect(call.allowedDomains).toBeUndefined();
    });

    it('package-managers adds PM domains + API domains', async () => {
      const envStore = makeMockEnvironmentStore({
        'env-1': {
          id: 'env-1',
          name: 'PM Only',
          networkMode: 'package-managers' as NetworkMode,
          allowedDomains: [],
          includePackageManagerDomains: false,
          dockerEnabled: true,
          envVars: '',
          setupScript: '',
          cpuLimit: 0,
          memoryLimit: '',
        },
      });
      manager.setEnvironmentStore(envStore);
      const workerStore = makeMockWorkerStore();
      manager.setWorkerStore(workerStore as any);

      await manager.create({ environmentId: 'env-1' });
      const call = (dockerService.createWorkerContainer as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.environmentJson.allowedDomains).toContain('registry.npmjs.org');
      expect(call.environmentJson.allowedDomains).toContain('api.anthropic.com');
      expect(call.environmentJson.allowedDomains).toContain('github.com');
    });

    it('custom adds user domains + optionally PM domains', async () => {
      const envStore = makeMockEnvironmentStore({
        'env-1': {
          id: 'env-1',
          name: 'Custom',
          networkMode: 'custom' as NetworkMode,
          allowedDomains: ['my-domain.com'],
          includePackageManagerDomains: true,
          dockerEnabled: true,
          envVars: '',
          setupScript: '',
          cpuLimit: 0,
          memoryLimit: '',
        },
      });
      manager.setEnvironmentStore(envStore);
      const workerStore = makeMockWorkerStore();
      manager.setWorkerStore(workerStore as any);

      await manager.create({ environmentId: 'env-1' });
      const call = (dockerService.createWorkerContainer as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.environmentJson.allowedDomains).toContain('my-domain.com');
      expect(call.environmentJson.allowedDomains).toContain('registry.npmjs.org');
      expect(call.environmentJson.allowedDomains).toContain('api.anthropic.com');
    });
  });

  describe('create', () => {
    it('calls DockerService.createWorkerContainer with correct args', async () => {
      const workerStore = makeMockWorkerStore();
      manager.setWorkerStore(workerStore as any);

      await manager.create({ name: 'test-worker', displayName: 'Test' });
      expect(dockerService.createWorkerContainer).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'test-worker', displayName: 'Test' })
      );
    });

    it('uses worker-level init script', async () => {
      const workerStore = makeMockWorkerStore();
      manager.setWorkerStore(workerStore as any);

      await manager.create({ initScript: '#!/bin/bash\ncodex' });
      const call = (dockerService.createWorkerContainer as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.workerJson.initScript).toBe('#!/bin/bash\ncodex');
    });

    it('no init script when worker does not provide one', async () => {
      const workerStore = makeMockWorkerStore();
      manager.setWorkerStore(workerStore as any);

      await manager.create({});
      const call = (dockerService.createWorkerContainer as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.workerJson.initScript).toBe('');
    });

    it('registers in WorkerStore', async () => {
      const workerStore = makeMockWorkerStore();
      manager.setWorkerStore(workerStore as any);

      await manager.create({ name: 'test-worker' });
      expect(workerStore.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'test-worker', status: 'active' })
      );
    });
  });

  describe('stop', () => {
    it('calls DockerService.stopContainer and updates status', async () => {
      // Populate a container first
      (dockerService.listContainers as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { Id: 'c1', Names: ['/w1'], State: 'running', Image: 'img', ImageID: 'imgid', Labels: { 'agentor.managed': 'true', 'agentor.created': '' } },
      ]);
      await manager.sync();

      await manager.stop('c1');
      expect(dockerService.stopContainer).toHaveBeenCalledWith('c1');
      expect(manager.get('c1')!.status).toBe('stopped');
    });
  });

  describe('restart', () => {
    it('calls DockerService.restartContainer and updates status', async () => {
      (dockerService.listContainers as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { Id: 'c1', Names: ['/w1'], State: 'exited', Image: 'img', ImageID: 'imgid', Labels: { 'agentor.managed': 'true', 'agentor.created': '' } },
      ]);
      await manager.sync();

      await manager.restart('c1');
      expect(dockerService.restartContainer).toHaveBeenCalledWith('c1');
      expect(manager.get('c1')!.status).toBe('running');
    });
  });

  describe('remove', () => {
    it('calls removeContainer + removes volumes + deletes worker record', async () => {
      const workerStore = makeMockWorkerStore();
      manager.setWorkerStore(workerStore as any);

      (dockerService.listContainers as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { Id: 'c1', Names: ['/w1'], State: 'running', Image: 'img', ImageID: 'imgid', Labels: { 'agentor.managed': 'true', 'agentor.created': '' } },
      ]);
      await manager.sync();

      await manager.remove('c1');
      expect(dockerService.removeContainer).toHaveBeenCalledWith('c1');
      expect(dockerService.removeVolume).toHaveBeenCalledWith('w1-docker');
      expect(dockerService.removeVolume).toHaveBeenCalledWith('w1-workspace');
      expect(workerStore.delete).toHaveBeenCalledWith('w1');
      expect(manager.get('c1')).toBeUndefined();
    });
  });

  describe('archive', () => {
    it('stops if running, removes container, archives in store', async () => {
      const workerStore = makeMockWorkerStore();
      manager.setWorkerStore(workerStore as any);

      (dockerService.listContainers as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { Id: 'c1', Names: ['/w1'], State: 'running', Image: 'img', ImageID: 'imgid', Labels: { 'agentor.managed': 'true', 'agentor.created': '' } },
      ]);
      await manager.sync();

      await manager.archive('c1');
      expect(dockerService.stopContainer).toHaveBeenCalledWith('c1');
      expect(dockerService.removeContainer).toHaveBeenCalledWith('c1');
      expect(workerStore.archive).toHaveBeenCalledWith('w1');
      expect(manager.get('c1')).toBeUndefined();
    });
  });

  describe('unarchive', () => {
    it('creates new container and unarchives in store', async () => {
      const workerStore = makeMockWorkerStore();
      manager.setWorkerStore(workerStore as any);

      // Insert an archived worker
      (workerStore as any)._items.set('w1', {
        id: '',
        name: 'w1',
        createdAt: '2024-01-01',
        status: 'archived',
        image: 'img',
        imageId: 'imgid',
        labels: {},
      } as WorkerRecord);
      (workerStore.get as ReturnType<typeof vi.fn>).mockImplementation((name: string) =>
        (workerStore as any)._items.get(name)
      );

      const result = await manager.unarchive('w1');
      expect(dockerService.createWorkerContainer).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'w1' })
      );
      expect(workerStore.unarchive).toHaveBeenCalledWith('w1', 'new-container-id');
      expect(result.status).toBe('running');
    });
  });

  describe('killTmuxWindow', () => {
    it('throws for main window (index 0)', async () => {
      await expect(manager.killTmuxWindow('c1', 0)).rejects.toThrow(
        'Cannot kill the main tmux window'
      );
    });
  });

  describe('getServiceStatus', () => {
    it('returns running=true for running container', async () => {
      (dockerService.listContainers as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { Id: 'c1', Names: ['/w1'], State: 'running', Image: 'img', ImageID: 'imgid', Labels: { 'agentor.managed': 'true', 'agentor.created': '' } },
      ]);
      await manager.sync();
      expect(manager.getServiceStatus('c1').running).toBe(true);
    });

    it('returns running=false for non-existent container', () => {
      expect(manager.getServiceStatus('nonexistent').running).toBe(false);
    });
  });

  describe('createAppInstance', () => {
    it('allocates first available port', async () => {
      (dockerService.listContainers as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { Id: 'c1', Names: ['/w1'], State: 'running', Image: 'img', ImageID: 'imgid', Labels: { 'agentor.managed': 'true', 'agentor.created': '' } },
      ]);
      await manager.sync();

      (dockerService.listAppInstances as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      const result = await manager.createAppInstance('c1', 'chromium');
      expect(result.port).toBe(9222);
    });

    it('throws when max instances reached', async () => {
      (dockerService.listContainers as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { Id: 'c1', Names: ['/w1'], State: 'running', Image: 'img', ImageID: 'imgid', Labels: { 'agentor.managed': 'true', 'agentor.created': '' } },
      ]);
      await manager.sync();

      const maxInstances = Array.from({ length: 10 }, (_, i) => ({
        id: `chromium-${i}`,
        appType: 'chromium',
        port: 9222 + i,
        status: 'running' as const,
      }));
      (dockerService.listAppInstances as ReturnType<typeof vi.fn>).mockResolvedValueOnce(maxInstances);

      await expect(manager.createAppInstance('c1', 'chromium')).rejects.toThrow(
        'Maximum Chromium instances reached'
      );
    });
  });

  describe('list', () => {
    it('returns all containers', async () => {
      (dockerService.listContainers as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { Id: 'c1', Names: ['/w1'], State: 'running', Image: 'img', ImageID: 'imgid', Labels: { 'agentor.managed': 'true', 'agentor.created': '' } },
        { Id: 'c2', Names: ['/w2'], State: 'exited', Image: 'img', ImageID: 'imgid', Labels: { 'agentor.managed': 'true', 'agentor.created': '' } },
      ]);
      await manager.sync();
      const list = manager.list();
      expect(list).toHaveLength(2);
    });
  });

  describe('uploadToWorkspace', () => {
    it('calls dockerService.putWorkspaceArchive for running container', async () => {
      (dockerService.listContainers as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { Id: 'c1', Names: ['/w1'], State: 'running', Image: 'img', ImageID: 'imgid', Labels: { 'agentor.managed': 'true', 'agentor.created': '' } },
      ]);
      await manager.sync();

      const buf = Buffer.from('tar-data');
      await manager.uploadToWorkspace('c1', buf);
      expect(dockerService.putWorkspaceArchive).toHaveBeenCalledWith('c1', buf);
    });

    it('throws for non-running container', async () => {
      (dockerService.listContainers as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { Id: 'c1', Names: ['/w1'], State: 'exited', Image: 'img', ImageID: 'imgid', Labels: { 'agentor.managed': 'true', 'agentor.created': '' } },
      ]);
      await manager.sync();
      await expect(manager.uploadToWorkspace('c1', Buffer.from(''))).rejects.toThrow('not running');
    });
  });

  describe('downloadWorkspace', () => {
    it('calls dockerService.getWorkspaceArchive for running container', async () => {
      (dockerService.listContainers as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { Id: 'c1', Names: ['/w1'], State: 'running', Image: 'img', ImageID: 'imgid', Labels: { 'agentor.managed': 'true', 'agentor.created': '' } },
      ]);
      await manager.sync();

      await manager.downloadWorkspace('c1');
      expect(dockerService.getWorkspaceArchive).toHaveBeenCalledWith('c1');
    });
  });

  describe('logs', () => {
    it('returns container logs', async () => {
      const logs = await manager.logs('c1');
      expect(logs).toBe('log output');
      expect(dockerService.getLogs).toHaveBeenCalledWith('c1', undefined);
    });

    it('passes tail parameter', async () => {
      await manager.logs('c1', 50);
      expect(dockerService.getLogs).toHaveBeenCalledWith('c1', 50);
    });
  });

  describe('listTmuxWindows', () => {
    it('delegates to dockerService', async () => {
      await manager.listTmuxWindows('c1');
      expect(dockerService.execListTmuxWindows).toHaveBeenCalledWith('c1');
    });
  });

  describe('createTmuxWindow', () => {
    it('creates window with custom name and returns TmuxWindow', async () => {
      (dockerService.execListTmuxWindows as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { index: 0, name: 'main', active: false },
        { index: 1, name: 'my-tab', active: true },
      ]);
      const result = await manager.createTmuxWindow('c1', 'my-tab');
      expect(result.name).toBe('my-tab');
      expect(result.index).toBe(1);
      expect(dockerService.execTmux).toHaveBeenCalledWith('c1', ['new-window', '-t', 'main:', '-n', 'my-tab']);
    });

    it('generates name when not provided', async () => {
      // Mock execListTmuxWindows to return a window matching any shell-* name
      (dockerService.execListTmuxWindows as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
        // Peek at what name was passed to execTmux
        const tmuxCall = (dockerService.execTmux as ReturnType<typeof vi.fn>).mock.calls.find(
          (c: string[][]) => c[1]?.[0] === 'new-window',
        );
        const windowName = tmuxCall?.[1]?.[4] ?? 'shell-xxxx';
        return [
          { index: 0, name: 'main', active: false },
          { index: 1, name: windowName, active: true },
        ];
      });
      const result = await manager.createTmuxWindow('c1');
      expect(result.name).toMatch(/^shell-/);
      expect(result.index).toBe(1);
    });
  });

  describe('renameTmuxWindow', () => {
    it('renames a tmux window by index', async () => {
      await manager.renameTmuxWindow('c1', 2, 'new-name');
      expect(dockerService.execTmux).toHaveBeenCalledWith('c1', ['rename-window', '-t', 'main:2', 'new-name']);
    });
  });

  describe('listAppInstances', () => {
    it('returns empty for non-running container', async () => {
      (dockerService.listContainers as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { Id: 'c1', Names: ['/w1'], State: 'exited', Image: 'img', ImageID: 'imgid', Labels: { 'agentor.managed': 'true', 'agentor.created': '' } },
      ]);
      await manager.sync();
      const instances = await manager.listAppInstances('c1', 'chromium');
      expect(instances).toEqual([]);
    });

    it('returns empty for non-existent container', async () => {
      const instances = await manager.listAppInstances('nonexistent', 'chromium');
      expect(instances).toEqual([]);
    });

    it('delegates to dockerService for running container', async () => {
      (dockerService.listContainers as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { Id: 'c1', Names: ['/w1'], State: 'running', Image: 'img', ImageID: 'imgid', Labels: { 'agentor.managed': 'true', 'agentor.created': '' } },
      ]);
      await manager.sync();
      await manager.listAppInstances('c1', 'chromium');
      expect(dockerService.listAppInstances).toHaveBeenCalledWith('c1', 'chromium');
    });
  });

  describe('stopAppInstance', () => {
    it('delegates to dockerService for running container', async () => {
      (dockerService.listContainers as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { Id: 'c1', Names: ['/w1'], State: 'running', Image: 'img', ImageID: 'imgid', Labels: { 'agentor.managed': 'true', 'agentor.created': '' } },
      ]);
      await manager.sync();
      await manager.stopAppInstance('c1', 'chromium', 'chrome-1');
      expect(dockerService.stopAppInstance).toHaveBeenCalledWith('c1', 'chromium', 'chrome-1');
    });

    it('throws for non-running container', async () => {
      (dockerService.listContainers as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { Id: 'c1', Names: ['/w1'], State: 'exited', Image: 'img', ImageID: 'imgid', Labels: { 'agentor.managed': 'true', 'agentor.created': '' } },
      ]);
      await manager.sync();
      await expect(manager.stopAppInstance('c1', 'chromium', 'chrome-1')).rejects.toThrow('not running');
    });
  });

  describe('createAppInstance', () => {
    it('throws for unknown app type', async () => {
      (dockerService.listContainers as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { Id: 'c1', Names: ['/w1'], State: 'running', Image: 'img', ImageID: 'imgid', Labels: { 'agentor.managed': 'true', 'agentor.created': '' } },
      ]);
      await manager.sync();
      await expect(manager.createAppInstance('c1', 'unknown-app')).rejects.toThrow('Unknown app type');
    });

    it('throws for non-running container', async () => {
      await expect(manager.createAppInstance('nonexistent', 'chromium')).rejects.toThrow('not running');
    });

    it('skips ports already in use', async () => {
      (dockerService.listContainers as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { Id: 'c1', Names: ['/w1'], State: 'running', Image: 'img', ImageID: 'imgid', Labels: { 'agentor.managed': 'true', 'agentor.created': '' } },
      ]);
      await manager.sync();

      (dockerService.listAppInstances as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { id: 'chrome-1', appType: 'chromium', port: 9222, status: 'running' },
      ]);
      const result = await manager.createAppInstance('c1', 'chromium');
      expect(result.port).toBe(9223); // Second port in range
    });
  });

  describe('deleteArchived', () => {
    it('removes volumes and worker record', async () => {
      const workerStore = makeMockWorkerStore();
      manager.setWorkerStore(workerStore as any);

      (workerStore as any)._items.set('w1', {
        id: '',
        name: 'w1',
        createdAt: '2024-01-01',
        status: 'archived',
        image: 'img',
        imageId: 'imgid',
        labels: {},
      } as WorkerRecord);
      (workerStore.get as ReturnType<typeof vi.fn>).mockImplementation((name: string) =>
        (workerStore as any)._items.get(name)
      );

      await manager.deleteArchived('w1');
      expect(dockerService.removeVolume).toHaveBeenCalledWith('w1-workspace');
      expect(dockerService.removeVolume).toHaveBeenCalledWith('w1-docker');
      expect(workerStore.delete).toHaveBeenCalledWith('w1');
    });

    it('throws when worker is not archived', async () => {
      const workerStore = makeMockWorkerStore();
      manager.setWorkerStore(workerStore as any);

      (workerStore.get as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
      await expect(manager.deleteArchived('nonexistent')).rejects.toThrow('Archived worker not found');
    });

    it('throws when workerStore is not set', async () => {
      await expect(manager.deleteArchived('w1')).rejects.toThrow('WorkerStore not available');
    });
  });

  describe('listArchived', () => {
    it('returns empty when no workerStore', () => {
      expect(manager.listArchived()).toEqual([]);
    });

    it('delegates to workerStore.listArchived', () => {
      const workerStore = makeMockWorkerStore();
      manager.setWorkerStore(workerStore as any);
      manager.listArchived();
      expect(workerStore.listArchived).toHaveBeenCalled();
    });
  });

  describe('archive edge cases', () => {
    it('throws for non-existent container', async () => {
      await expect(manager.archive('nonexistent')).rejects.toThrow('Container not found');
    });

    it('archives stopped container without stopping first', async () => {
      const workerStore = makeMockWorkerStore();
      manager.setWorkerStore(workerStore as any);

      (dockerService.listContainers as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { Id: 'c1', Names: ['/w1'], State: 'exited', Image: 'img', ImageID: 'imgid', Labels: { 'agentor.managed': 'true', 'agentor.created': '' } },
      ]);
      await manager.sync();

      await manager.archive('c1');
      // stopContainer should NOT be called since it's already stopped
      expect(dockerService.stopContainer).not.toHaveBeenCalled();
      expect(dockerService.removeContainer).toHaveBeenCalledWith('c1');
    });
  });

  describe('unarchive edge cases', () => {
    it('throws when workerStore is not set', async () => {
      await expect(manager.unarchive('w1')).rejects.toThrow('WorkerStore not available');
    });

    it('throws when worker is not archived', async () => {
      const workerStore = makeMockWorkerStore();
      manager.setWorkerStore(workerStore as any);

      (workerStore.get as ReturnType<typeof vi.fn>).mockReturnValue({ name: 'w1', status: 'active' });
      await expect(manager.unarchive('w1')).rejects.toThrow('Archived worker not found');
    });

    it('gracefully handles deleted environment on unarchive', async () => {
      const workerStore = makeMockWorkerStore();
      manager.setWorkerStore(workerStore as any);

      const envStore = makeMockEnvironmentStore({}); // Empty — environment deleted
      manager.setEnvironmentStore(envStore);

      (workerStore as any)._items.set('w1', {
        id: '',
        name: 'w1',
        createdAt: '2024-01-01',
        status: 'archived',
        image: 'img',
        imageId: 'imgid',
        labels: {},
        environmentId: 'deleted-env',
        cpuLimit: 4,
        memoryLimit: '2g',
        networkMode: 'full',
      } as unknown as WorkerRecord);
      (workerStore.get as ReturnType<typeof vi.fn>).mockImplementation((name: string) =>
        (workerStore as any)._items.get(name)
      );

      const result = await manager.unarchive('w1');
      expect(result.status).toBe('running');
      // Should fall back to worker's stored config
      const call = (dockerService.createWorkerContainer as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.cpuLimit).toBe(4);
    });
  });

  describe('resolveEnvironmentConfig edge cases', () => {
    it('throws when environment not found', async () => {
      const envStore = makeMockEnvironmentStore({});
      manager.setEnvironmentStore(envStore);
      const workerStore = makeMockWorkerStore();
      manager.setWorkerStore(workerStore as any);

      await expect(manager.create({ environmentId: 'nonexistent' })).rejects.toThrow('Environment not found');
    });

    it('parses env vars with comments and empty lines', async () => {
      const envStore = makeMockEnvironmentStore({
        'env-1': {
          id: 'env-1',
          name: 'Test',
          networkMode: 'full' as NetworkMode,
          allowedDomains: [],
          includePackageManagerDomains: false,
          dockerEnabled: true,
          envVars: '# comment\nFOO=bar\n\n  # another comment\nBAZ=qux\ninvalid_no_equals',
          setupScript: '',
          cpuLimit: 0,
          memoryLimit: '',
        },
      });
      manager.setEnvironmentStore(envStore);
      const workerStore = makeMockWorkerStore();
      manager.setWorkerStore(workerStore as any);

      await manager.create({ environmentId: 'env-1' });
      const call = (dockerService.createWorkerContainer as ReturnType<typeof vi.fn>).mock.calls[0][0];
      // envVars is now passed as raw string in the ENVIRONMENT JSON payload — entrypoint parses it
      expect(call.environmentJson.envVars).toContain('FOO=bar');
      expect(call.environmentJson.envVars).toContain('BAZ=qux');
    });

    it('block mode adds API and git domains', async () => {
      const envStore = makeMockEnvironmentStore({
        'env-1': {
          id: 'env-1',
          name: 'Block',
          networkMode: 'block' as NetworkMode,
          allowedDomains: [],
          includePackageManagerDomains: false,
          dockerEnabled: true,
          envVars: '',
          setupScript: '',
          cpuLimit: 0,
          memoryLimit: '',
        },
      });
      manager.setEnvironmentStore(envStore);
      const workerStore = makeMockWorkerStore();
      manager.setWorkerStore(workerStore as any);

      await manager.create({ environmentId: 'env-1' });
      const call = (dockerService.createWorkerContainer as ReturnType<typeof vi.fn>).mock.calls[0][0];
      // block mode should have API + git domains (not PM domains)
      expect(call.environmentJson.allowedDomains).toContain('api.anthropic.com');
      expect(call.environmentJson.allowedDomains).toContain('github.com');
      expect(call.environmentJson.allowedDomains).not.toContain('registry.npmjs.org');
    });
  });

  describe('reconcileWorkers', () => {
    it('archives active workers with no Docker container', async () => {
      const workerStore = makeMockWorkerStore();
      manager.setWorkerStore(workerStore as any);

      (workerStore as any)._items.set('orphan', {
        id: 'old-id',
        name: 'orphan',
        status: 'active',
        createdAt: '2024-01-01',
        image: 'img',
        imageId: 'imgid',
        labels: {},
      } as WorkerRecord);
      (workerStore.listActive as ReturnType<typeof vi.fn>).mockReturnValue([
        (workerStore as any)._items.get('orphan'),
      ]);

      // sync with empty docker list
      (dockerService.listContainers as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      await manager.sync();

      await manager.reconcileWorkers();
      expect(workerStore.archive).toHaveBeenCalledWith('orphan');
    });

    it('upserts active workers from Docker', async () => {
      const workerStore = makeMockWorkerStore();
      manager.setWorkerStore(workerStore as any);
      (workerStore.listActive as ReturnType<typeof vi.fn>).mockReturnValue([]);

      (dockerService.listContainers as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { Id: 'c1', Names: ['/w1'], State: 'running', Image: 'img', ImageID: 'imgid', Labels: { 'agentor.managed': 'true', 'agentor.created': '2024-01-01' } },
      ]);
      await manager.sync();

      await manager.reconcileWorkers();
      expect(workerStore.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'w1', status: 'active' })
      );
    });
  });
});
