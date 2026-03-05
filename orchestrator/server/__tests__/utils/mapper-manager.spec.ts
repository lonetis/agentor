import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Config } from '../../utils/config';
import type { PortMapping } from '../../utils/port-mapping-store';

// --- Mock dockerode ---
const mockContainerStart = vi.fn().mockResolvedValue(undefined);
const mockCreateContainer = vi.fn().mockResolvedValue({ start: mockContainerStart });
const mockListContainers = vi.fn().mockResolvedValue([]);
const mockContainerRemove = vi.fn().mockResolvedValue(undefined);
const mockContainerInspect = vi.fn().mockResolvedValue({ State: { Running: true }, HostConfig: { PortBindings: {} } });
const mockImageInspect = vi.fn().mockResolvedValue({});
const mockGetImage = vi.fn().mockReturnValue({ inspect: mockImageInspect });
const mockGetContainer = vi.fn().mockReturnValue({
  inspect: mockContainerInspect,
  remove: mockContainerRemove,
  start: vi.fn().mockResolvedValue(undefined),
});
const mockFollowProgress = vi.fn();
const mockPull = vi.fn();

vi.mock('dockerode', () => {
  const MockDocker = vi.fn().mockImplementation(() => ({
    createContainer: mockCreateContainer,
    listContainers: mockListContainers,
    getContainer: mockGetContainer,
    getImage: mockGetImage,
    pull: mockPull,
    modem: { followProgress: mockFollowProgress },
  }));
  return { default: MockDocker };
});

import { MapperManager } from '../../utils/mapper-manager';

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
    dataVolume: 'agentor-data',
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

function makeMockStore(mappings: PortMapping[] = []) {
  return {
    list: vi.fn(() => mappings),
  } as any;
}

describe('MapperManager', () => {
  let manager: MapperManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockListContainers.mockResolvedValue([]);
    mockContainerInspect.mockResolvedValue({ State: { Running: true }, HostConfig: { PortBindings: {} } });
  });

  describe('buildPortBindings (via reconcile)', () => {
    it('localhost mapping produces 127.0.0.1 binding', async () => {
      const mapping: PortMapping = {
        externalPort: 8080,
        type: 'localhost',
        workerId: 'w1',
        workerName: 'worker-1',
        internalPort: 3000,
      };
      const store = makeMockStore([mapping]);
      manager = new MapperManager(makeConfig(), store);

      await manager.reconcile();
      const call = mockCreateContainer.mock.calls[0]?.[0];
      expect(call.HostConfig.PortBindings['8080/tcp']).toEqual([
        { HostIp: '127.0.0.1', HostPort: '8080' },
      ]);
    });

    it('external mapping produces 0.0.0.0 binding', async () => {
      const mapping: PortMapping = {
        externalPort: 9090,
        type: 'external',
        workerId: 'w1',
        workerName: 'worker-1',
        internalPort: 3000,
      };
      const store = makeMockStore([mapping]);
      manager = new MapperManager(makeConfig(), store);

      await manager.reconcile();
      const call = mockCreateContainer.mock.calls[0]?.[0];
      expect(call.HostConfig.PortBindings['9090/tcp']).toEqual([
        { HostIp: '0.0.0.0', HostPort: '9090' },
      ]);
    });
  });

  describe('bindingsMatch (via reconcile behavior)', () => {
    it('returns true for identical bindings — skips recreate', async () => {
      const mapping: PortMapping = {
        externalPort: 8080,
        type: 'localhost',
        workerId: 'w1',
        workerName: 'worker-1',
        internalPort: 3000,
      };
      const store = makeMockStore([mapping]);
      manager = new MapperManager(makeConfig(), store);

      // Mapper already exists with matching bindings
      mockListContainers.mockResolvedValue([{ Id: 'mapper-1' }]);
      mockContainerInspect.mockResolvedValue({
        State: { Running: true },
        HostConfig: {
          PortBindings: {
            '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '8080' }],
          },
        },
      });

      await manager.reconcile();
      // Should not recreate — no createContainer call
      expect(mockCreateContainer).not.toHaveBeenCalled();
    });

    it('returns false for different ports — triggers recreate', async () => {
      const mapping: PortMapping = {
        externalPort: 9090,
        type: 'external',
        workerId: 'w1',
        workerName: 'worker-1',
        internalPort: 3000,
      };
      const store = makeMockStore([mapping]);
      manager = new MapperManager(makeConfig(), store);

      mockListContainers.mockResolvedValue([{ Id: 'mapper-1' }]);
      mockContainerInspect.mockResolvedValue({
        State: { Running: true },
        HostConfig: {
          PortBindings: {
            '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '8080' }],
          },
        },
      });

      await manager.reconcile();
      // Should remove old and create new
      expect(mockContainerRemove).toHaveBeenCalled();
      expect(mockCreateContainer).toHaveBeenCalled();
    });

    it('returns false for null current — creates mapper', async () => {
      const mapping: PortMapping = {
        externalPort: 8080,
        type: 'localhost',
        workerId: 'w1',
        workerName: 'worker-1',
        internalPort: 3000,
      };
      const store = makeMockStore([mapping]);
      manager = new MapperManager(makeConfig(), store);

      // No existing mapper
      mockListContainers.mockResolvedValue([]);
      await manager.reconcile();
      expect(mockCreateContainer).toHaveBeenCalled();
    });
  });

  describe('reconcile', () => {
    it('removes mapper when no mappings', async () => {
      const store = makeMockStore([]);
      manager = new MapperManager(makeConfig(), store);

      mockListContainers.mockResolvedValue([{ Id: 'mapper-1' }]);
      await manager.reconcile();
      expect(mockContainerRemove).toHaveBeenCalled();
      expect(mockCreateContainer).not.toHaveBeenCalled();
    });

    it('starts container if stopped', async () => {
      const mapping: PortMapping = {
        externalPort: 8080,
        type: 'localhost',
        workerId: 'w1',
        workerName: 'worker-1',
        internalPort: 3000,
      };
      const store = makeMockStore([mapping]);
      manager = new MapperManager(makeConfig(), store);

      const mockStart = vi.fn().mockResolvedValue(undefined);
      mockListContainers.mockResolvedValue([{ Id: 'mapper-1' }]);
      mockGetContainer.mockReturnValue({
        inspect: vi.fn().mockResolvedValue({
          State: { Running: false },
          HostConfig: {
            PortBindings: {
              '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '8080' }],
            },
          },
        }),
        remove: mockContainerRemove,
        start: mockStart,
      });

      await manager.reconcile();
      expect(mockStart).toHaveBeenCalled();
    });
  });

  describe('forceRecreate', () => {
    it('always removes and recreates when mappings exist', async () => {
      const mapping: PortMapping = {
        externalPort: 8080,
        type: 'localhost',
        workerId: 'w1',
        workerName: 'worker-1',
        internalPort: 3000,
      };
      const store = makeMockStore([mapping]);
      manager = new MapperManager(makeConfig(), store);

      mockListContainers.mockResolvedValue([{ Id: 'mapper-1' }]);
      await manager.forceRecreate();
      expect(mockContainerRemove).toHaveBeenCalled();
      expect(mockCreateContainer).toHaveBeenCalled();
    });

    it('does nothing when no mappings', async () => {
      const store = makeMockStore([]);
      manager = new MapperManager(makeConfig(), store);

      await manager.forceRecreate();
      expect(mockContainerRemove).not.toHaveBeenCalled();
      expect(mockCreateContainer).not.toHaveBeenCalled();
    });
  });
});
