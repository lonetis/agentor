import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies that services.ts imports
vi.mock('dockerode', () => {
  const MockDocker = vi.fn().mockImplementation(() => ({}));
  return { default: MockDocker };
});

vi.mock('../../utils/config', () => ({
  loadConfig: vi.fn(() => ({
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
    dataDir: '/tmp/test-services',
    baseDomains: [],
    dashboardBaseDomain: '',
    dashboardSubdomain: '',
    acmeEmail: '',
    traefikImage: 'traefik:v3',
    dashboardAuthUser: '',
    dashboardAuthPassword: '',
  })),
}));

vi.mock('../../utils/docker', () => ({
  DockerService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../utils/container', () => ({
  ContainerManager: vi.fn().mockImplementation(() => ({})),
}));

const mockPortStore = {
  removeForWorker: vi.fn().mockResolvedValue(0),
};
vi.mock('../../utils/port-mapping-store', () => ({
  PortMappingStore: vi.fn().mockImplementation(() => mockPortStore),
}));

const mockMapperReconcile = vi.fn().mockResolvedValue(undefined);
vi.mock('../../utils/mapper-manager', () => ({
  MapperManager: vi.fn().mockImplementation(() => ({ reconcile: mockMapperReconcile })),
}));

const mockDomainStore = {
  removeForWorker: vi.fn().mockResolvedValue(0),
};
vi.mock('../../utils/domain-mapping-store', () => ({
  DomainMappingStore: vi.fn().mockImplementation(() => mockDomainStore),
}));

const mockTraefikReconcile = vi.fn().mockResolvedValue(undefined);
vi.mock('../../utils/traefik-manager', () => ({
  TraefikManager: vi.fn().mockImplementation(() => ({ reconcile: mockTraefikReconcile })),
}));

vi.mock('../../utils/github', () => ({
  GitHubService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../utils/environments', () => ({
  EnvironmentStore: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../utils/worker-store', () => ({
  WorkerStore: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../utils/update-checker', () => ({
  UpdateChecker: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../utils/usage-checker', () => ({
  UsageChecker: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../utils/credential-mounts', () => ({
  CredentialMountManager: vi.fn().mockImplementation(() => ({})),
}));

describe('services', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module cache so singletons are re-created
    vi.resetModules();
  });

  describe('singleton pattern', () => {
    it('useConfig returns same instance on multiple calls', async () => {
      const { useConfig } = await import('../../utils/services');
      const a = useConfig();
      const b = useConfig();
      expect(a).toBe(b);
    });

    it('useDockerService returns same instance on multiple calls', async () => {
      const { useDockerService } = await import('../../utils/services');
      const a = useDockerService();
      const b = useDockerService();
      expect(a).toBe(b);
    });

    it('useContainerManager returns same instance on multiple calls', async () => {
      const { useContainerManager } = await import('../../utils/services');
      const a = useContainerManager();
      const b = useContainerManager();
      expect(a).toBe(b);
    });

    it('usePortMappingStore returns same instance', async () => {
      const { usePortMappingStore } = await import('../../utils/services');
      const a = usePortMappingStore();
      const b = usePortMappingStore();
      expect(a).toBe(b);
    });

    it('useMapperManager returns same instance', async () => {
      const { useMapperManager } = await import('../../utils/services');
      const a = useMapperManager();
      const b = useMapperManager();
      expect(a).toBe(b);
    });

    it('useDomainMappingStore returns same instance', async () => {
      const { useDomainMappingStore } = await import('../../utils/services');
      const a = useDomainMappingStore();
      const b = useDomainMappingStore();
      expect(a).toBe(b);
    });

    it('useTraefikManager returns same instance', async () => {
      const { useTraefikManager } = await import('../../utils/services');
      const a = useTraefikManager();
      const b = useTraefikManager();
      expect(a).toBe(b);
    });

    it('useGitHubService returns same instance', async () => {
      const { useGitHubService } = await import('../../utils/services');
      const a = useGitHubService();
      const b = useGitHubService();
      expect(a).toBe(b);
    });

    it('useEnvironmentStore returns same instance', async () => {
      const { useEnvironmentStore } = await import('../../utils/services');
      const a = useEnvironmentStore();
      const b = useEnvironmentStore();
      expect(a).toBe(b);
    });

    it('useWorkerStore returns same instance', async () => {
      const { useWorkerStore } = await import('../../utils/services');
      const a = useWorkerStore();
      const b = useWorkerStore();
      expect(a).toBe(b);
    });

    it('useUpdateChecker returns same instance', async () => {
      const { useUpdateChecker } = await import('../../utils/services');
      const a = useUpdateChecker();
      const b = useUpdateChecker();
      expect(a).toBe(b);
    });

    it('useUsageChecker returns same instance', async () => {
      const { useUsageChecker } = await import('../../utils/services');
      const a = useUsageChecker();
      const b = useUsageChecker();
      expect(a).toBe(b);
    });

    it('useCredentialMountManager returns same instance', async () => {
      const { useCredentialMountManager } = await import('../../utils/services');
      const a = useCredentialMountManager();
      const b = useCredentialMountManager();
      expect(a).toBe(b);
    });
  });

  describe('cleanupWorkerMappings', () => {
    it('reconciles mapper when port mappings removed', async () => {
      const { cleanupWorkerMappings } = await import('../../utils/services');
      mockPortStore.removeForWorker.mockResolvedValueOnce(2);
      mockDomainStore.removeForWorker.mockResolvedValueOnce(0);

      await cleanupWorkerMappings('worker-1');

      expect(mockPortStore.removeForWorker).toHaveBeenCalledWith('worker-1');
      expect(mockDomainStore.removeForWorker).toHaveBeenCalledWith('worker-1');
      expect(mockMapperReconcile).toHaveBeenCalled();
      expect(mockTraefikReconcile).not.toHaveBeenCalled();
    });

    it('reconciles traefik when domain mappings removed', async () => {
      const { cleanupWorkerMappings } = await import('../../utils/services');
      mockPortStore.removeForWorker.mockResolvedValueOnce(0);
      mockDomainStore.removeForWorker.mockResolvedValueOnce(3);

      await cleanupWorkerMappings('worker-2');

      expect(mockMapperReconcile).not.toHaveBeenCalled();
      expect(mockTraefikReconcile).toHaveBeenCalled();
    });

    it('reconciles both when both types removed', async () => {
      const { cleanupWorkerMappings } = await import('../../utils/services');
      mockPortStore.removeForWorker.mockResolvedValueOnce(1);
      mockDomainStore.removeForWorker.mockResolvedValueOnce(1);

      await cleanupWorkerMappings('worker-3');

      expect(mockMapperReconcile).toHaveBeenCalled();
      expect(mockTraefikReconcile).toHaveBeenCalled();
    });

    it('reconciles neither when no mappings removed', async () => {
      const { cleanupWorkerMappings } = await import('../../utils/services');
      mockPortStore.removeForWorker.mockResolvedValueOnce(0);
      mockDomainStore.removeForWorker.mockResolvedValueOnce(0);

      await cleanupWorkerMappings('worker-4');

      expect(mockMapperReconcile).not.toHaveBeenCalled();
      expect(mockTraefikReconcile).not.toHaveBeenCalled();
    });
  });
});
