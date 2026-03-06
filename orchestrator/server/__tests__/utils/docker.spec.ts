import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock dockerode ---
const mockContainerStart = vi.fn().mockResolvedValue(undefined);
const mockCreateContainer = vi.fn().mockResolvedValue({
  start: mockContainerStart,
  id: 'mock-container-id',
});
const mockListContainers = vi.fn().mockResolvedValue([]);
const mockListNetworks = vi.fn().mockResolvedValue([]);
const mockCreateNetwork = vi.fn().mockResolvedValue(undefined);
const mockImageInspect = vi.fn().mockResolvedValue({});
const mockGetImage = vi.fn().mockReturnValue({ inspect: mockImageInspect });

const mockExecStart = vi.fn();
const mockContainerExec = vi.fn();
const mockContainerStop = vi.fn().mockResolvedValue(undefined);
const mockContainerRemove = vi.fn().mockResolvedValue(undefined);
const mockContainerRestart = vi.fn().mockResolvedValue(undefined);
const mockContainerLogs = vi.fn().mockResolvedValue(Buffer.from('log output'));
const mockContainerPutArchive = vi.fn().mockResolvedValue(undefined);
const mockContainerGetArchive = vi.fn().mockResolvedValue({});
const mockContainerInspect = vi.fn().mockResolvedValue({ State: { Running: true } });

const mockGetContainer = vi.fn().mockReturnValue({
  inspect: mockContainerInspect,
  exec: mockContainerExec,
  start: vi.fn(),
  stop: mockContainerStop,
  remove: mockContainerRemove,
  restart: mockContainerRestart,
  logs: mockContainerLogs,
  putArchive: mockContainerPutArchive,
  getArchive: mockContainerGetArchive,
});

const mockExecResize = vi.fn().mockResolvedValue(undefined);
const mockGetExec = vi.fn().mockReturnValue({ resize: mockExecResize });
const mockVolumeRemove = vi.fn().mockResolvedValue(undefined);
const mockGetVolume = vi.fn().mockReturnValue({ remove: mockVolumeRemove });
const mockPull = vi.fn();
const mockFollowProgress = vi.fn();

vi.mock('dockerode', () => {
  const MockDocker = vi.fn().mockImplementation(() => ({
    createContainer: mockCreateContainer,
    listContainers: mockListContainers,
    listNetworks: mockListNetworks,
    createNetwork: mockCreateNetwork,
    getImage: mockGetImage,
    getContainer: mockGetContainer,
    getExec: mockGetExec,
    getVolume: mockGetVolume,
    pull: mockPull,
    modem: { followProgress: mockFollowProgress },
  }));
  return { default: MockDocker };
});

import { DockerService } from '../../utils/docker';
import type { EnvironmentJsonPayload, SkillJsonEntry, AgentsMdJsonEntry, WorkerJsonPayload } from '../../utils/docker';
import type { Config } from '../../utils/config';

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

const defaultEnvironmentJson: EnvironmentJsonPayload = {
  networkMode: 'full',
  allowedDomains: [],
  dockerEnabled: false,
  setupScript: '',
  envVars: '',
  exposeApis: { portMappings: true, domainMappings: true, usage: true },
};

const defaultWorkerJson: WorkerJsonPayload = {
  name: 'test',
  displayName: '',
  repos: [],
  initScript: '',
};

function makeOpts(overrides: Record<string, unknown> = {}): {
  name: string;
  displayName?: string;
  cpuLimit?: number;
  memoryLimit?: string;
  mounts?: { source: string; target: string; readOnly?: boolean }[];
  dockerEnabled?: boolean;
  credentialBinds?: string[];
  environmentId?: string;
  environmentName?: string;
  environmentJson: EnvironmentJsonPayload;
  skillsJson: SkillJsonEntry[];
  agentsMdJson: AgentsMdJsonEntry[];
  workerJson: WorkerJsonPayload;
} {
  const name = (overrides.name as string) ?? 'test';
  return {
    name,
    environmentJson: { ...defaultEnvironmentJson },
    skillsJson: [],
    agentsMdJson: [],
    workerJson: { ...defaultWorkerJson, name },
    ...overrides,
  } as ReturnType<typeof makeOpts>;
}

describe('DockerService', () => {
  let service: DockerService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DockerService(makeConfig());
  });

  describe('ensureNetwork', () => {
    it('creates network when none exists', async () => {
      mockListNetworks.mockResolvedValueOnce([]);
      await service.ensureNetwork();
      expect(mockCreateNetwork).toHaveBeenCalledWith({
        Name: 'agentor-net',
        Driver: 'bridge',
      });
    });

    it('skips creation when network exists', async () => {
      mockListNetworks.mockResolvedValueOnce([{ Name: 'agentor-net' }]);
      await service.ensureNetwork();
      expect(mockCreateNetwork).not.toHaveBeenCalled();
    });
  });

  describe('createWorkerContainer', () => {
    it('sets correct labels', async () => {
      await service.createWorkerContainer(makeOpts({ name: 'test-worker' }));
      const call = mockCreateContainer.mock.calls[0]![0];
      expect(call.Labels['agentor.managed']).toBe('true');
      expect(call.Labels['agentor.created']).toBeDefined();
    });

    it('passes repos in WORKER JSON env var', async () => {
      const repos = [{ provider: 'github', url: 'https://github.com/test/repo' }];
      await service.createWorkerContainer(makeOpts({
        name: 'test-worker',
        workerJson: { ...defaultWorkerJson, name: 'test-worker', repos },
      }));
      const call = mockCreateContainer.mock.calls[0]![0];
      const workerEnv = call.Env.find((e: string) => e.startsWith('WORKER='));
      const parsed = JSON.parse(workerEnv!.substring(7));
      expect(parsed.repos).toEqual(repos);
    });

    it('adds workspace volume bind', async () => {
      await service.createWorkerContainer(makeOpts({ name: 'my-worker' }));
      const call = mockCreateContainer.mock.calls[0]![0];
      expect(call.HostConfig.Binds).toContain('my-worker-workspace:/workspace');
    });

    it('adds docker volume when dockerEnabled', async () => {
      await service.createWorkerContainer(makeOpts({ name: 'my-worker', dockerEnabled: true }));
      const call = mockCreateContainer.mock.calls[0]![0];
      expect(call.HostConfig.Binds).toContain('my-worker-docker:/var/lib/docker');
    });

    it('adds NET_ADMIN cap for restricted network mode', async () => {
      await service.createWorkerContainer(makeOpts({
        environmentJson: { ...defaultEnvironmentJson, networkMode: 'block' },
      }));
      const call = mockCreateContainer.mock.calls[0]![0];
      expect(call.HostConfig.CapAdd).toEqual(['NET_ADMIN']);
    });

    it('does not add NET_ADMIN when dockerEnabled (privileged implies all caps)', async () => {
      await service.createWorkerContainer(makeOpts({
        dockerEnabled: true,
        environmentJson: { ...defaultEnvironmentJson, networkMode: 'block' },
      }));
      const call = mockCreateContainer.mock.calls[0]![0];
      expect(call.HostConfig.CapAdd ?? []).toEqual([]);
      expect(call.HostConfig.Privileged).toBe(true);
    });

    it('sets privileged mode for dockerEnabled', async () => {
      await service.createWorkerContainer(makeOpts({ dockerEnabled: true }));
      const call = mockCreateContainer.mock.calls[0]![0];
      expect(call.HostConfig.Privileged).toBe(true);
    });

    it('merges credential binds', async () => {
      const creds = ['/host/cred/claude.json:/home/agent/.claude/.credentials.json'];
      await service.createWorkerContainer(makeOpts({ credentialBinds: creds }));
      const call = mockCreateContainer.mock.calls[0]![0];
      expect(call.HostConfig.Binds).toContain(creds[0]);
    });

    it('sets correct Memory for 512m limit', async () => {
      await service.createWorkerContainer(makeOpts({ memoryLimit: '512m' }));
      const call = mockCreateContainer.mock.calls[0]![0];
      expect(call.HostConfig.Memory).toBe(512 * 1024 * 1024);
    });

    it('sets correct Memory for 2g limit', async () => {
      await service.createWorkerContainer(makeOpts({ memoryLimit: '2g' }));
      const call = mockCreateContainer.mock.calls[0]![0];
      expect(call.HostConfig.Memory).toBe(2 * 1024 * 1024 * 1024);
    });

    it('sets correct Memory for 1024k limit', async () => {
      await service.createWorkerContainer(makeOpts({ memoryLimit: '1024k' }));
      const call = mockCreateContainer.mock.calls[0]![0];
      expect(call.HostConfig.Memory).toBe(1024 * 1024);
    });

    it('throws for invalid memory limit', async () => {
      await expect(
        service.createWorkerContainer(makeOpts({ memoryLimit: 'invalid' }))
      ).rejects.toThrow('Invalid memory limit');
    });

    it('sets display-name label when provided', async () => {
      await service.createWorkerContainer(makeOpts({ displayName: 'My Worker' }));
      const call = mockCreateContainer.mock.calls[0]![0];
      expect(call.Labels['agentor.display-name']).toBe('My Worker');
    });

    it('stores repos in labels as JSON', async () => {
      const repos = [{ provider: 'github', url: 'https://github.com/test/repo' }];
      await service.createWorkerContainer(makeOpts({
        workerJson: { ...defaultWorkerJson, repos },
      }));
      const call = mockCreateContainer.mock.calls[0]![0];
      expect(call.Labels['agentor.repos']).toBe(JSON.stringify(repos));
    });

    it('passes environment JSON and labels', async () => {
      await service.createWorkerContainer(makeOpts({
        environmentJson: { ...defaultEnvironmentJson, networkMode: 'custom', allowedDomains: ['example.com'] },
        environmentId: 'env-1',
        environmentName: 'Test Env',
      }));
      const call = mockCreateContainer.mock.calls[0]![0];
      const envJson = call.Env.find((e: string) => e.startsWith('ENVIRONMENT='));
      const parsed = JSON.parse(envJson!.substring(12));
      expect(parsed.networkMode).toBe('custom');
      expect(parsed.allowedDomains).toEqual(['example.com']);
      expect(call.Labels['agentor.environment-id']).toBe('env-1');
      expect(call.Labels['agentor.environment-name']).toBe('Test Env');
    });
  });

  describe('listContainers', () => {
    it('filters by managed label', async () => {
      await service.listContainers();
      expect(mockListContainers).toHaveBeenCalledWith({
        all: true,
        filters: { label: ['agentor.managed=true'] },
      });
    });
  });

  describe('removeVolume', () => {
    it('ignores errors (volume not found)', async () => {
      mockGetVolume.mockReturnValueOnce({
        remove: vi.fn().mockRejectedValue(new Error('not found')),
      });
      // Should not throw
      await service.removeVolume('nonexistent');
    });
  });

  describe('getLogs', () => {
    it('returns string', async () => {
      const logs = await service.getLogs('container-id');
      expect(logs).toBe('log output');
    });
  });

  describe('execListTmuxWindows', () => {
    it('parses "0:main:1\\n1:shell:0" format', async () => {
      // Create a readable stream mock
      const { Readable } = await import('node:stream');
      const stream = new Readable({
        read() {
          this.push(Buffer.from('0:main:1\n1:shell:0\n'));
          this.push(null);
        },
      });
      mockContainerExec.mockResolvedValueOnce({
        start: vi.fn().mockResolvedValue(stream),
      });

      const windows = await service.execListTmuxWindows('container-id');
      expect(windows).toEqual([
        { index: 0, name: 'main', active: true },
        { index: 1, name: 'shell', active: false },
      ]);
    });

    it('returns empty array for empty output', async () => {
      const { Readable } = await import('node:stream');
      const stream = new Readable({
        read() {
          this.push(Buffer.from(''));
          this.push(null);
        },
      });
      mockContainerExec.mockResolvedValueOnce({
        start: vi.fn().mockResolvedValue(stream),
      });

      const windows = await service.execListTmuxWindows('container-id');
      expect(windows).toEqual([]);
    });
  });

  describe('execTmux', () => {
    it('executes tmux command in container', async () => {
      mockContainerExec.mockResolvedValueOnce({
        start: vi.fn().mockResolvedValue(undefined),
      });

      await service.execTmux('container-id', ['new-window', '-n', 'test']);

      expect(mockContainerExec).toHaveBeenCalledWith({
        Cmd: ['tmux', 'new-window', '-n', 'test'],
        AttachStdout: true,
        AttachStderr: true,
      });
    });
  });

  describe('resizeExec', () => {
    it('resizes exec instance', async () => {
      await service.resizeExec('exec-123', 120, 40);
      expect(mockGetExec).toHaveBeenCalledWith('exec-123');
      expect(mockExecResize).toHaveBeenCalledWith({ h: 40, w: 120 });
    });
  });

  describe('stopContainer', () => {
    it('stops the container', async () => {
      await service.stopContainer('container-id');
      expect(mockGetContainer).toHaveBeenCalledWith('container-id');
      expect(mockContainerStop).toHaveBeenCalled();
    });
  });

  describe('removeContainer', () => {
    it('removes the container with force', async () => {
      await service.removeContainer('container-id');
      expect(mockGetContainer).toHaveBeenCalledWith('container-id');
      expect(mockContainerRemove).toHaveBeenCalledWith({ force: true });
    });
  });

  describe('restartContainer', () => {
    it('restarts the container', async () => {
      await service.restartContainer('container-id');
      expect(mockGetContainer).toHaveBeenCalledWith('container-id');
      expect(mockContainerRestart).toHaveBeenCalled();
    });
  });

  describe('putWorkspaceArchive', () => {
    it('uploads tar to /workspace', async () => {
      const tar = Buffer.from('tar-content');
      await service.putWorkspaceArchive('container-id', tar);
      expect(mockContainerPutArchive).toHaveBeenCalledWith(tar, { path: '/workspace' });
    });
  });

  describe('getWorkspaceArchive', () => {
    it('downloads archive from /workspace', async () => {
      await service.getWorkspaceArchive('container-id');
      expect(mockContainerGetArchive).toHaveBeenCalledWith({ path: '/workspace' });
    });
  });

  describe('ensureImage', () => {
    it('does nothing when image exists', async () => {
      mockImageInspect.mockResolvedValueOnce({});
      await service['ensureImage']('my-image:latest');
      expect(mockPull).not.toHaveBeenCalled();
    });

    it('pulls image when not found locally', async () => {
      mockImageInspect.mockRejectedValueOnce(new Error('not found'));
      const { Readable } = await import('node:stream');
      const pullStream = new Readable({ read() { this.push(null); } });
      mockPull.mockResolvedValueOnce(pullStream);
      mockFollowProgress.mockImplementation(
        (_stream: unknown, cb: (err: Error | null) => void) => cb(null)
      );

      await service['ensureImage']('my-image:latest');
      expect(mockPull).toHaveBeenCalledWith('my-image:latest');
    });
  });

  describe('execAppManage', () => {
    it('executes app manage script and returns output', async () => {
      const { Readable } = await import('node:stream');
      const stream = new Readable({
        read() {
          this.push(Buffer.from('app-output'));
          this.push(null);
        },
      });
      mockContainerExec.mockResolvedValueOnce({
        start: vi.fn().mockResolvedValue(stream),
      });

      const output = await service.execAppManage('container-id', 'chromium', ['list']);
      expect(output).toBe('app-output');
    });

    it('throws for unknown app type', async () => {
      await expect(
        service.execAppManage('container-id', 'unknown-app', ['list'])
      ).rejects.toThrow('Unknown app type: unknown-app');
    });
  });

  describe('listAppInstances', () => {
    it('parses app list output', async () => {
      const { Readable } = await import('node:stream');
      const stream = new Readable({
        read() {
          this.push(Buffer.from('chrome-1:9222:running\nchrome-2:9223:stopped\n'));
          this.push(null);
        },
      });
      mockContainerExec.mockResolvedValueOnce({
        start: vi.fn().mockResolvedValue(stream),
      });

      const instances = await service.listAppInstances('container-id', 'chromium');
      expect(instances).toEqual([
        { id: 'chrome-1', appType: 'chromium', port: 9222, status: 'running' },
        { id: 'chrome-2', appType: 'chromium', port: 9223, status: 'stopped' },
      ]);
    });

    it('returns empty array for empty output', async () => {
      const { Readable } = await import('node:stream');
      const stream = new Readable({
        read() {
          this.push(Buffer.from(''));
          this.push(null);
        },
      });
      mockContainerExec.mockResolvedValueOnce({
        start: vi.fn().mockResolvedValue(stream),
      });

      const instances = await service.listAppInstances('container-id', 'chromium');
      expect(instances).toEqual([]);
    });
  });

  describe('startAppInstance', () => {
    it('returns trimmed output on success', async () => {
      const { Readable } = await import('node:stream');
      const stream = new Readable({
        read() {
          this.push(Buffer.from('chrome-1\n'));
          this.push(null);
        },
      });
      mockContainerExec.mockResolvedValueOnce({
        start: vi.fn().mockResolvedValue(stream),
      });

      const result = await service.startAppInstance('container-id', 'chromium', 'chrome-1', 9222);
      expect(result).toBe('chrome-1');
    });

    it('throws when output starts with ERR:', async () => {
      const { Readable } = await import('node:stream');
      const stream = new Readable({
        read() {
          this.push(Buffer.from('ERR:port in use'));
          this.push(null);
        },
      });
      mockContainerExec.mockResolvedValueOnce({
        start: vi.fn().mockResolvedValue(stream),
      });

      await expect(
        service.startAppInstance('container-id', 'chromium', 'chrome-1', 9222)
      ).rejects.toThrow('port in use');
    });
  });

  describe('stopAppInstance', () => {
    it('succeeds silently on normal output', async () => {
      const { Readable } = await import('node:stream');
      const stream = new Readable({
        read() {
          this.push(Buffer.from('OK\n'));
          this.push(null);
        },
      });
      mockContainerExec.mockResolvedValueOnce({
        start: vi.fn().mockResolvedValue(stream),
      });

      await service.stopAppInstance('container-id', 'chromium', 'chrome-1');
    });

    it('throws when output starts with ERR:', async () => {
      const { Readable } = await import('node:stream');
      const stream = new Readable({
        read() {
          this.push(Buffer.from('ERR:not running'));
          this.push(null);
        },
      });
      mockContainerExec.mockResolvedValueOnce({
        start: vi.fn().mockResolvedValue(stream),
      });

      await expect(
        service.stopAppInstance('container-id', 'chromium', 'chrome-1')
      ).rejects.toThrow('not running');
    });
  });

  describe('execAttachTmuxWindow', () => {
    it('uses window index and returns exec + stream', async () => {
      const { Duplex } = await import('node:stream');
      const mockStream = new Duplex({
        read() {},
        write(_chunk, _enc, cb) { cb(); },
      });

      mockContainerExec.mockResolvedValueOnce({
        id: 'exec-attach',
        start: vi.fn().mockResolvedValue(mockStream),
      });

      const result = await service.execAttachTmuxWindow('container-id', 3);
      expect(result.exec.id).toBe('exec-attach');
      expect(result.stream).toBe(mockStream);

      // Verify the tmux command uses the numeric index
      const cmd = mockContainerExec.mock.calls[0]![0].Cmd;
      expect(cmd[2]).toContain('$SID:3');
    });
  });

  describe('parseMemoryLimit', () => {
    it('handles bytes (b)', async () => {
      await service.createWorkerContainer(makeOpts({ memoryLimit: '1024b' }));
      const call = mockCreateContainer.mock.calls[0]![0];
      expect(call.HostConfig.Memory).toBe(1024);
    });

    it('handles kilobytes (kb)', async () => {
      await service.createWorkerContainer(makeOpts({ memoryLimit: '10kb' }));
      const call = mockCreateContainer.mock.calls[0]![0];
      expect(call.HostConfig.Memory).toBe(10 * 1024);
    });

    it('handles megabytes (mb)', async () => {
      await service.createWorkerContainer(makeOpts({ memoryLimit: '256mb' }));
      const call = mockCreateContainer.mock.calls[0]![0];
      expect(call.HostConfig.Memory).toBe(256 * 1024 * 1024);
    });

    it('handles gigabytes (gb)', async () => {
      await service.createWorkerContainer(makeOpts({ memoryLimit: '4gb' }));
      const call = mockCreateContainer.mock.calls[0]![0];
      expect(call.HostConfig.Memory).toBe(4 * 1024 * 1024 * 1024);
    });

    it('handles decimal values', async () => {
      await service.createWorkerContainer(makeOpts({ memoryLimit: '1.5g' }));
      const call = mockCreateContainer.mock.calls[0]![0];
      expect(call.HostConfig.Memory).toBe(Math.floor(1.5 * 1024 * 1024 * 1024));
    });
  });

  describe('createWorkerContainer additional scenarios', () => {
    it('sets NanoCpus for CPU limit', async () => {
      await service.createWorkerContainer(makeOpts({ cpuLimit: 2 }));
      const call = mockCreateContainer.mock.calls[0]![0];
      expect(call.HostConfig.NanoCpus).toBe(2e9);
    });

    it('includes setup script in ENVIRONMENT JSON', async () => {
      await service.createWorkerContainer(makeOpts({
        environmentJson: { ...defaultEnvironmentJson, setupScript: 'apt-get install -y curl' },
      }));
      const call = mockCreateContainer.mock.calls[0]![0];
      const envJson = call.Env.find((e: string) => e.startsWith('ENVIRONMENT='));
      const parsed = JSON.parse(envJson!.substring(12));
      expect(parsed.setupScript).toBe('apt-get install -y curl');
    });

    it('includes init script in WORKER JSON', async () => {
      await service.createWorkerContainer(makeOpts({
        workerJson: { ...defaultWorkerJson, initScript: 'claude --dangerously-skip-permissions' },
      }));
      const call = mockCreateContainer.mock.calls[0]![0];
      const workerEnv = call.Env.find((e: string) => e.startsWith('WORKER='));
      const parsed = JSON.parse(workerEnv!.substring(7));
      expect(parsed.initScript).toBe('claude --dangerously-skip-permissions');
    });

    it('adds bind mounts from mounts config', async () => {
      await service.createWorkerContainer(makeOpts({
        mounts: [
          { source: '/host/data', target: '/data', readOnly: true },
          { source: '/host/config', target: '/config', readOnly: false },
        ],
      }));
      const call = mockCreateContainer.mock.calls[0]![0];
      expect(call.HostConfig.Binds).toContain('/host/data:/data:ro');
      expect(call.HostConfig.Binds).toContain('/host/config:/config');
    });

    it('does not set network-mode label for full mode', async () => {
      await service.createWorkerContainer(makeOpts({
        environmentJson: { ...defaultEnvironmentJson, networkMode: 'full' },
      }));
      const call = mockCreateContainer.mock.calls[0]![0];
      expect(call.Labels['agentor.network-mode']).toBeUndefined();
    });

    it('no Memory or NanoCpus when limits are zero/empty', async () => {
      await service.createWorkerContainer(makeOpts());
      const call = mockCreateContainer.mock.calls[0]![0];
      expect(call.HostConfig.NanoCpus).toBeUndefined();
      expect(call.HostConfig.Memory).toBeUndefined();
    });
  });
});
