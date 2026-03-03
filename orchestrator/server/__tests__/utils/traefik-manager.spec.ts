import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import type { Config } from '../../utils/config';
import type { DomainMapping } from '../../utils/domain-mapping-store';

// --- Mock node:fs/promises ---
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockAccess = vi.fn();

vi.mock('node:fs/promises', () => ({
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  access: (...args: unknown[]) => mockAccess(...args),
}));

// --- Mock dockerode ---
const mockContainerStart = vi.fn().mockResolvedValue(undefined);
const mockCreateContainer = vi.fn().mockResolvedValue({ start: mockContainerStart });
const mockListContainers = vi.fn().mockResolvedValue([]);
const mockContainerRemove = vi.fn().mockResolvedValue(undefined);
const mockContainerInspect = vi.fn().mockResolvedValue({ State: { Running: true } });
const mockContainerRestart = vi.fn().mockResolvedValue(undefined);
const mockImageInspect = vi.fn().mockResolvedValue({});
const mockGetImage = vi.fn().mockReturnValue({ inspect: mockImageInspect });
const mockGetContainer = vi.fn().mockReturnValue({
  inspect: mockContainerInspect,
  remove: mockContainerRemove,
  start: vi.fn().mockResolvedValue(undefined),
  restart: mockContainerRestart,
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

import { TraefikManager } from '../../utils/traefik-manager';

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
    baseDomains: ['example.com'],
    dashboardBaseDomain: 'example.com',
    dashboardSubdomain: '',
    acmeEmail: 'test@example.com',
    traefikImage: 'traefik:v3',
    dashboardAuthUser: '',
    dashboardAuthPassword: '',
    ...overrides,
  };
}

function makeMockStore(mappings: DomainMapping[] = []) {
  return {
    list: vi.fn(() => mappings),
  } as any;
}

describe('TraefikManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListContainers.mockResolvedValue([]);
    mockAccess.mockRejectedValue(new Error('ENOENT')); // default: config file doesn't exist
  });

  describe('generateHtpasswd (via writeTraefikConfig)', () => {
    it('produces correct SHA1 format', async () => {
      // Test via dashboard auth
      const config = makeConfig({
        dashboardSubdomain: 'dash',
        dashboardAuthUser: 'admin',
        dashboardAuthPassword: 'secret',
      });
      const store = makeMockStore([]);
      const manager = new TraefikManager(config, store);

      await manager.init();

      // Find the writeFile call for traefik-config.json
      const configCall = mockWriteFile.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('traefik-config.json') && c[1] !== '{}'
      );
      expect(configCall).toBeDefined();

      const parsed = JSON.parse(configCall![1] as string);
      const expectedHash = createHash('sha1').update('secret').digest('base64');
      expect(parsed.http.middlewares['auth-dashboard'].basicAuth.users[0]).toBe(
        `admin:{SHA}${expectedHash}`
      );
    });
  });

  describe('writeTraefikConfig', () => {
    it('dashboard router with auth middleware', async () => {
      const config = makeConfig({
        dashboardSubdomain: 'panel',
        dashboardAuthUser: 'admin',
        dashboardAuthPassword: 'pass',
      });
      const store = makeMockStore([]);
      const manager = new TraefikManager(config, store);

      await manager.init();

      const configCall = mockWriteFile.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('traefik-config.json') && c[1] !== '{}'
      );
      const parsed = JSON.parse(configCall![1] as string);
      expect(parsed.http.routers['dashboard']).toBeDefined();
      expect(parsed.http.routers['dashboard'].rule).toBe('Host(`panel.example.com`)');
      expect(parsed.http.routers['dashboard'].middlewares).toContain('auth-dashboard');
    });

    it('HTTPS mapping creates websecure router', async () => {
      const mapping: DomainMapping = {
        id: 'map-1',
        subdomain: 'app',
        baseDomain: 'example.com',
        protocol: 'https',
        workerId: 'w1',
        workerName: 'worker-1',
        internalPort: 3000,
      };
      const store = makeMockStore([mapping]);
      const manager = new TraefikManager(makeConfig(), store);

      await manager.init();

      const configCall = mockWriteFile.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('traefik-config.json') && c[1] !== '{}'
      );
      const parsed = JSON.parse(configCall![1] as string);
      expect(parsed.http.routers['http-map-1']).toBeDefined();
      expect(parsed.http.routers['http-map-1'].entryPoints).toEqual(['websecure']);
      expect(parsed.http.routers['http-map-1'].tls).toBeDefined();
    });

    it('HTTP mapping creates web router', async () => {
      const mapping: DomainMapping = {
        id: 'map-2',
        subdomain: 'api',
        baseDomain: 'example.com',
        protocol: 'http',
        workerId: 'w1',
        workerName: 'worker-1',
        internalPort: 8080,
      };
      const store = makeMockStore([mapping]);
      const manager = new TraefikManager(makeConfig(), store);

      await manager.init();

      const configCall = mockWriteFile.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('traefik-config.json') && c[1] !== '{}'
      );
      const parsed = JSON.parse(configCall![1] as string);
      expect(parsed.http.routers['http-map-2']).toBeDefined();
      expect(parsed.http.routers['http-map-2'].entryPoints).toEqual(['web']);
      expect(parsed.http.routers['http-map-2'].tls).toBeUndefined();
    });

    it('TCP mapping creates tcp router/service', async () => {
      const mapping: DomainMapping = {
        id: 'map-3',
        subdomain: 'tcp',
        baseDomain: 'example.com',
        protocol: 'tcp',
        workerId: 'w1',
        workerName: 'worker-1',
        internalPort: 5432,
      };
      const store = makeMockStore([mapping]);
      const manager = new TraefikManager(makeConfig(), store);

      await manager.init();

      const configCall = mockWriteFile.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('traefik-config.json') && c[1] !== '{}'
      );
      const parsed = JSON.parse(configCall![1] as string);
      expect(parsed.tcp.routers['tcp-map-3']).toBeDefined();
      expect(parsed.tcp.routers['tcp-map-3'].rule).toBe('HostSNI(`tcp.example.com`)');
      expect(parsed.tcp.services['tcp-map-3'].loadBalancer.servers[0].address).toBe('worker-1:5432');
    });

    it('basic auth generates middleware', async () => {
      const mapping: DomainMapping = {
        id: 'map-4',
        subdomain: 'secure',
        baseDomain: 'example.com',
        protocol: 'https',
        workerId: 'w1',
        workerName: 'worker-1',
        internalPort: 3000,
        basicAuth: { username: 'user', password: 'pass123' },
      };
      const store = makeMockStore([mapping]);
      const manager = new TraefikManager(makeConfig(), store);

      await manager.init();

      const configCall = mockWriteFile.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('traefik-config.json') && c[1] !== '{}'
      );
      const parsed = JSON.parse(configCall![1] as string);
      expect(parsed.http.middlewares['auth-map-4']).toBeDefined();
      expect(parsed.http.routers['http-map-4'].middlewares).toContain('auth-map-4');
    });

    it('strips empty sub-objects', async () => {
      // No mappings and no dashboard => config should be empty (or stripped)
      const store = makeMockStore([]);
      const config = makeConfig({ dashboardSubdomain: '' });
      const manager = new TraefikManager(config, store);

      await manager.init();

      // When no mappings and no dashboard, reconcile should remove Traefik not write config
      // But we can check that if it does write, empty sections are stripped
      // The reconcile with 0 mappings and no dashboard removes Traefik, so writeTraefikConfig won't be called
      // Let's test with a mapping to ensure non-empty sections survive and empty ones are stripped
      const mapping: DomainMapping = {
        id: 'map-5',
        subdomain: 'app',
        baseDomain: 'example.com',
        protocol: 'https',
        workerId: 'w1',
        workerName: 'worker-1',
        internalPort: 3000,
      };
      const store2 = makeMockStore([mapping]);
      const manager2 = new TraefikManager(makeConfig(), store2);

      await manager2.init();

      const configCall = mockWriteFile.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('traefik-config.json') && c[1] !== '{}'
      );
      const parsed = JSON.parse(configCall![1] as string);
      // tcp section should not exist since there are no tcp mappings
      expect(parsed.tcp).toBeUndefined();
      // http should have routers and services
      expect(parsed.http.routers).toBeDefined();
      expect(parsed.http.services).toBeDefined();
      // middlewares should not exist (no basic auth)
      expect(parsed.http.middlewares).toBeUndefined();
    });
  });

  describe('reconcile', () => {
    it('creates Traefik when mappings exist', async () => {
      const mapping: DomainMapping = {
        id: 'map-1',
        subdomain: 'app',
        baseDomain: 'example.com',
        protocol: 'https',
        workerId: 'w1',
        workerName: 'worker-1',
        internalPort: 3000,
      };
      const store = makeMockStore([mapping]);
      const manager = new TraefikManager(makeConfig(), store);

      await manager.init();
      expect(mockCreateContainer).toHaveBeenCalled();
    });

    it('removes Traefik when no mappings and no dashboard', async () => {
      const store = makeMockStore([]);
      const config = makeConfig({ dashboardSubdomain: '' });
      const manager = new TraefikManager(config, store);

      mockListContainers.mockResolvedValue([{ Id: 'traefik-1' }]);
      await manager.init();
      expect(mockContainerRemove).toHaveBeenCalled();
    });

    it('keeps Traefik for dashboard-only config', async () => {
      const store = makeMockStore([]);
      const config = makeConfig({ dashboardSubdomain: 'dash' });
      const manager = new TraefikManager(config, store);

      // No existing Traefik container
      mockListContainers.mockResolvedValue([]);
      await manager.init();
      expect(mockCreateContainer).toHaveBeenCalled();
    });
  });

  describe('init', () => {
    it('skips when no baseDomains', async () => {
      const store = makeMockStore([]);
      const config = makeConfig({ baseDomains: [] });
      const manager = new TraefikManager(config, store);

      await manager.init();
      // Should not write any config or create any container
      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(mockCreateContainer).not.toHaveBeenCalled();
    });
  });

  describe('forceRecreate', () => {
    it('removes and recreates when mappings exist', async () => {
      const mapping: DomainMapping = {
        id: 'map-1',
        subdomain: 'app',
        baseDomain: 'example.com',
        protocol: 'https',
        workerId: 'w1',
        workerName: 'worker-1',
        internalPort: 3000,
      };
      const store = makeMockStore([mapping]);
      const config = makeConfig();
      const manager = new TraefikManager(config, store);

      mockListContainers.mockResolvedValue([{ Id: 'traefik-1' }]);
      await manager.forceRecreate();
      expect(mockContainerRemove).toHaveBeenCalled();
      expect(mockCreateContainer).toHaveBeenCalled();
    });
  });
});
