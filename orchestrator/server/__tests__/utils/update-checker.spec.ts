import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Config } from '../../utils/config';

// --- Mock dockerode ---
const mockImageInspect = vi.fn();
const mockGetImage = vi.fn().mockReturnValue({ inspect: mockImageInspect });
const mockContainerInspect = vi.fn();
const mockContainerRemove = vi.fn().mockResolvedValue(undefined);
const mockGetContainer = vi.fn().mockReturnValue({
  inspect: mockContainerInspect,
  remove: mockContainerRemove,
});
const mockCreateContainer = vi.fn().mockResolvedValue({
  id: 'new-container-id',
  start: vi.fn().mockResolvedValue(undefined),
});
const mockFollowProgress = vi.fn();
const mockPull = vi.fn();

vi.mock('dockerode', () => {
  const MockDocker = vi.fn().mockImplementation(() => ({
    getImage: mockGetImage,
    getContainer: mockGetContainer,
    createContainer: mockCreateContainer,
    pull: mockPull,
    modem: { followProgress: mockFollowProgress },
  }));
  return { default: MockDocker };
});

import { UpdateChecker } from '../../utils/update-checker';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    githubToken: 'ghp_test123',
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
    ...overrides,
  };
}

describe('UpdateChecker', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 })
    );
    // Default: image exists locally
    mockImageInspect.mockResolvedValue({ RepoDigests: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    fetchSpy.mockRestore();
  });

  describe('parseImageRef (tested via checkImage/getRemoteDigest)', () => {
    // We test parseImageRef indirectly by calling check() and inspecting fetch URLs

    it('GHCR image (ghcr.io/org/repo:tag) fetches correct registry', async () => {
      const checker = new UpdateChecker(makeConfig({
        workerImagePrefix: 'ghcr.io/myorg/',
        workerImage: 'agentor-worker:latest',
      }));

      fetchSpy.mockImplementation(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('ghcr.io/token')) {
          return new Response(JSON.stringify({ token: 'test-token' }), { status: 200 });
        }
        if (url.includes('ghcr.io/v2/')) {
          return new Response('', {
            status: 200,
            headers: { 'docker-content-digest': 'sha256:remote123' },
          });
        }
        return new Response('{}', { status: 200 });
      });

      mockImageInspect.mockResolvedValue({
        RepoDigests: ['ghcr.io/myorg/agentor-worker@sha256:local123'],
      });

      await checker.check();
      // Verify GHCR token was requested
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('ghcr.io/token'),
        expect.anything()
      );
    });

    it('Docker Hub user image (user/repo:tag)', async () => {
      const checker = new UpdateChecker(makeConfig({
        baseDomains: ['example.com'],
        traefikImage: 'myuser/myproxy:v1',
      }));

      fetchSpy.mockImplementation(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('auth.docker.io/token')) {
          return new Response(JSON.stringify({ token: 'hub-token' }), { status: 200 });
        }
        if (url.includes('registry-1.docker.io/v2/')) {
          return new Response('', {
            status: 200,
            headers: { 'docker-content-digest': 'sha256:remote456' },
          });
        }
        return new Response('{}', { status: 200 });
      });

      mockImageInspect.mockResolvedValue({ RepoDigests: [] });
      await checker.check();
      // Should have fetched from Docker Hub registry
      const calls = fetchSpy.mock.calls.map((c) => (typeof c[0] === 'string' ? c[0] : ''));
      expect(calls.some((url) => url.includes('auth.docker.io/token'))).toBe(true);
    });

    it('Official image (traefik:v3 -> library/traefik)', async () => {
      const checker = new UpdateChecker(makeConfig({
        baseDomains: ['example.com'],
        traefikImage: 'traefik:v3',
      }));

      fetchSpy.mockImplementation(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('auth.docker.io/token')) {
          return new Response(JSON.stringify({ token: 'hub-token' }), { status: 200 });
        }
        if (url.includes('registry-1.docker.io/v2/library/traefik')) {
          return new Response('', {
            status: 200,
            headers: { 'docker-content-digest': 'sha256:traefik-remote' },
          });
        }
        return new Response('{}', { status: 200 });
      });

      mockImageInspect.mockResolvedValue({ RepoDigests: [] });
      await checker.check();
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('registry-1.docker.io/v2/library/traefik/manifests/v3'),
        expect.anything()
      );
    });

    it('Bare name (nginx -> library/nginx:latest)', async () => {
      // Test via a config that references just 'nginx'
      const checker = new UpdateChecker(makeConfig({
        baseDomains: ['example.com'],
        traefikImage: 'nginx',
      }));

      fetchSpy.mockImplementation(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('auth.docker.io/token')) {
          return new Response(JSON.stringify({ token: 'hub-token' }), { status: 200 });
        }
        if (url.includes('registry-1.docker.io/v2/library/nginx/manifests/latest')) {
          return new Response('', {
            status: 200,
            headers: { 'docker-content-digest': 'sha256:nginx-remote' },
          });
        }
        return new Response('{}', { status: 200 });
      });

      mockImageInspect.mockResolvedValue({ RepoDigests: [] });
      await checker.check();
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('registry-1.docker.io/v2/library/nginx/manifests/latest'),
        expect.anything()
      );
    });
  });

  describe('isProductionMode', () => {
    it('true when workerImagePrefix set', () => {
      const checker = new UpdateChecker(makeConfig({ workerImagePrefix: 'ghcr.io/org/' }));
      expect(checker.getStatus().isProductionMode).toBe(true);
    });

    it('true when baseDomains set', () => {
      const checker = new UpdateChecker(makeConfig({ baseDomains: ['example.com'] }));
      expect(checker.getStatus().isProductionMode).toBe(true);
    });

    it('false when neither set', () => {
      const checker = new UpdateChecker(makeConfig({ workerImagePrefix: '', baseDomains: [] }));
      expect(checker.getStatus().isProductionMode).toBe(false);
    });
  });

  describe('checkImage', () => {
    it('updateAvailable when digests differ', async () => {
      const checker = new UpdateChecker(makeConfig({
        workerImagePrefix: 'ghcr.io/org/',
      }));

      mockImageInspect.mockResolvedValue({
        RepoDigests: ['ghcr.io/org/agentor-worker@sha256:local111'],
      });

      fetchSpy.mockImplementation(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('ghcr.io/token')) {
          return new Response(JSON.stringify({ token: 'tok' }), { status: 200 });
        }
        if (url.includes('/v2/')) {
          return new Response('', {
            status: 200,
            headers: { 'docker-content-digest': 'sha256:remote222' },
          });
        }
        return new Response('{}', { status: 200 });
      });

      const status = await checker.check();
      // At least one image should show update available
      const updates = [status.orchestrator, status.mapper, status.worker].filter(
        (i) => i?.updateAvailable
      );
      expect(updates.length).toBeGreaterThan(0);
    });

    it('no update when digests match', async () => {
      const checker = new UpdateChecker(makeConfig({
        workerImagePrefix: 'ghcr.io/org/',
      }));

      mockImageInspect.mockResolvedValue({
        RepoDigests: ['ghcr.io/org/agentor-worker@sha256:same123'],
      });

      fetchSpy.mockImplementation(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('ghcr.io/token')) {
          return new Response(JSON.stringify({ token: 'tok' }), { status: 200 });
        }
        if (url.includes('/v2/')) {
          return new Response('', {
            status: 200,
            headers: { 'docker-content-digest': 'sha256:same123' },
          });
        }
        return new Response('{}', { status: 200 });
      });

      const status = await checker.check();
      const updates = [status.orchestrator, status.mapper, status.worker].filter(
        (i) => i?.updateAvailable
      );
      expect(updates.length).toBe(0);
    });

    it('handles fetch errors gracefully', async () => {
      const checker = new UpdateChecker(makeConfig({
        workerImagePrefix: 'ghcr.io/org/',
      }));

      fetchSpy.mockRejectedValue(new Error('Network error'));

      const status = await checker.check();
      // Should not throw — errors are caught per image
      expect(status.worker).toBeDefined();
      expect(status.worker!.error).toBeDefined();
    });
  });

  describe('getStatus', () => {
    it('returns all image statuses', () => {
      const checker = new UpdateChecker(makeConfig({ workerImagePrefix: 'ghcr.io/org/' }));
      const status = checker.getStatus();
      expect(status).toHaveProperty('orchestrator');
      expect(status).toHaveProperty('mapper');
      expect(status).toHaveProperty('worker');
      expect(status).toHaveProperty('traefik');
      expect(status).toHaveProperty('isProductionMode');
    });
  });

  describe('applyUpdates', () => {
    it('not in production mode returns error', async () => {
      const checker = new UpdateChecker(makeConfig({ workerImagePrefix: '', baseDomains: [] }));
      const result = await checker.applyUpdates();
      expect(result.errors).toContain('Not in production mode');
    });

    it('pulls only images with updates available', async () => {
      const config = makeConfig({ workerImagePrefix: 'ghcr.io/org/' });
      const checker = new UpdateChecker(config);

      // Manually set status to have one update available
      const status = checker.getStatus();
      status.worker = {
        name: 'ghcr.io/org/agentor-worker:latest',
        localDigest: 'sha256:old',
        remoteDigest: 'sha256:new',
        updateAvailable: true,
        lastChecked: new Date().toISOString(),
      };
      status.mapper = {
        name: 'ghcr.io/org/agentor-mapper:latest',
        localDigest: 'sha256:same',
        remoteDigest: 'sha256:same',
        updateAvailable: false,
        lastChecked: new Date().toISOString(),
      };

      // Mock pullImage (it uses docker.pull with callback style)
      mockPull.mockImplementation(
        (_image: string, _opts: unknown, cb: (err: Error | null, stream: NodeJS.ReadableStream | undefined) => void) => {
          const { Readable } = require('node:stream');
          const stream = new Readable({ read() { this.push(null); } });
          cb(null, stream);
        }
      );
      mockFollowProgress.mockImplementation(
        (_stream: unknown, cb: (err: Error | null) => void) => cb(null)
      );

      const result = await checker.applyUpdates();
      expect(result.workerPulled).toBe(true);
      expect(result.mapperPulled).toBe(false);
    });

    it('respects image filter', async () => {
      const config = makeConfig({ workerImagePrefix: 'ghcr.io/org/' });
      const checker = new UpdateChecker(config);

      const status = checker.getStatus();
      status.worker = {
        name: 'ghcr.io/org/agentor-worker:latest',
        localDigest: 'sha256:old',
        remoteDigest: 'sha256:new',
        updateAvailable: true,
        lastChecked: new Date().toISOString(),
      };
      status.mapper = {
        name: 'ghcr.io/org/agentor-mapper:latest',
        localDigest: 'sha256:old',
        remoteDigest: 'sha256:new',
        updateAvailable: true,
        lastChecked: new Date().toISOString(),
      };

      mockPull.mockImplementation(
        (_image: string, _opts: unknown, cb: (err: Error | null, stream: NodeJS.ReadableStream | undefined) => void) => {
          const { Readable } = require('node:stream');
          const stream = new Readable({ read() { this.push(null); } });
          cb(null, stream);
        }
      );
      mockFollowProgress.mockImplementation(
        (_stream: unknown, cb: (err: Error | null) => void) => cb(null)
      );

      // Only update worker
      const result = await checker.applyUpdates(['worker']);
      expect(result.workerPulled).toBe(true);
      expect(result.mapperPulled).toBe(false);
    });

    it('accumulates errors', async () => {
      const config = makeConfig({ workerImagePrefix: 'ghcr.io/org/' });
      const checker = new UpdateChecker(config);

      const status = checker.getStatus();
      status.worker = {
        name: 'ghcr.io/org/agentor-worker:latest',
        localDigest: 'sha256:old',
        remoteDigest: 'sha256:new',
        updateAvailable: true,
        lastChecked: new Date().toISOString(),
      };

      mockPull.mockImplementation(
        (_image: string, _opts: unknown, cb: (err: Error | null, stream: NodeJS.ReadableStream | undefined) => void) => {
          cb(new Error('Pull failed'), undefined);
        }
      );

      const result = await checker.applyUpdates();
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Worker pull failed');
    });
  });

  describe('getRegistryToken', () => {
    it('GHCR uses Basic auth with github token', async () => {
      const config = makeConfig({
        workerImagePrefix: 'ghcr.io/org/',
        githubToken: 'ghp_mytoken',
      });
      const checker = new UpdateChecker(config);

      fetchSpy.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('ghcr.io/token')) {
          // Verify Basic auth header
          const authHeader = (init?.headers as Record<string, string>)?.['Authorization'];
          if (authHeader?.startsWith('Basic ')) {
            return new Response(JSON.stringify({ token: 'bearer-token' }), { status: 200 });
          }
          return new Response('', { status: 401 });
        }
        if (url.includes('/v2/')) {
          return new Response('', {
            status: 200,
            headers: { 'docker-content-digest': 'sha256:abc' },
          });
        }
        return new Response('{}', { status: 200 });
      });

      mockImageInspect.mockResolvedValue({ RepoDigests: [] });
      await checker.check();

      // Verify the Basic auth was used for GHCR token request
      const tokenCall = fetchSpy.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('ghcr.io/token')
      );
      expect(tokenCall).toBeDefined();
      const headers = (tokenCall![1] as RequestInit)?.headers as Record<string, string>;
      const decoded = Buffer.from(headers['Authorization'].replace('Basic ', ''), 'base64').toString();
      expect(decoded).toBe('token:ghp_mytoken');
    });
  });

  describe('getLocalDigest', () => {
    it('extracts digest from RepoDigests', async () => {
      const config = makeConfig({ workerImagePrefix: 'ghcr.io/org/' });
      const checker = new UpdateChecker(config);

      mockImageInspect.mockResolvedValue({
        RepoDigests: ['ghcr.io/org/agentor-orchestrator@sha256:abc123def'],
      });

      // Trigger init to populate local digests
      fetchSpy.mockResolvedValue(new Response('{}', { status: 200 }));
      await checker.check();

      const status = checker.getStatus();
      expect(status.orchestrator?.localDigest).toBe('sha256:abc123def');
    });

    it('returns empty string when image not found locally', async () => {
      const config = makeConfig({ workerImagePrefix: 'ghcr.io/org/' });
      const checker = new UpdateChecker(config);

      mockImageInspect.mockRejectedValue(new Error('not found'));
      fetchSpy.mockResolvedValue(new Response('{}', { status: 200 }));
      await checker.check();

      const status = checker.getStatus();
      expect(status.orchestrator?.localDigest).toBe('');
    });

    it('falls back to qualified Docker Hub prefix', async () => {
      const config = makeConfig({ baseDomains: ['example.com'], traefikImage: 'traefik:v3' });
      const checker = new UpdateChecker(config);

      mockImageInspect.mockResolvedValue({
        RepoDigests: ['docker.io/library/traefik@sha256:traefik-digest-abc'],
      });

      fetchSpy.mockImplementation(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('auth.docker.io/token')) {
          return new Response(JSON.stringify({ token: 'tok' }), { status: 200 });
        }
        return new Response('', { status: 200, headers: { 'docker-content-digest': 'sha256:traefik-digest-abc' } });
      });

      await checker.check();

      const status = checker.getStatus();
      expect(status.traefik?.localDigest).toBe('sha256:traefik-digest-abc');
    });

    it('falls back to first digest entry when no prefix match', async () => {
      const config = makeConfig({ workerImagePrefix: 'ghcr.io/org/' });
      const checker = new UpdateChecker(config);

      mockImageInspect.mockResolvedValue({
        RepoDigests: ['some-other-registry/repo@sha256:fallback-digest'],
      });

      fetchSpy.mockResolvedValue(new Response('{}', { status: 200 }));
      await checker.check();

      const status = checker.getStatus();
      expect(status.orchestrator?.localDigest).toBe('sha256:fallback-digest');
    });
  });

  describe('pullImage', () => {
    it('pulls GHCR image with auth', async () => {
      const config = makeConfig({
        workerImagePrefix: 'ghcr.io/org/',
        githubToken: 'ghp_test',
      });
      const checker = new UpdateChecker(config);

      mockPull.mockImplementation(
        (_image: string, _opts: unknown, cb: (err: Error | null, stream: NodeJS.ReadableStream | undefined) => void) => {
          const { Readable } = require('node:stream');
          const stream = new Readable({ read() { this.push(null); } });
          cb(null, stream);
        }
      );
      mockFollowProgress.mockImplementation(
        (_stream: unknown, cb: (err: Error | null) => void) => cb(null)
      );

      await checker.pullImage('ghcr.io/org/agentor-worker:latest');

      expect(mockPull).toHaveBeenCalledWith(
        'ghcr.io/org/agentor-worker:latest',
        { authconfig: { username: 'token', password: 'ghp_test' } },
        expect.any(Function)
      );
    });

    it('pulls Docker Hub image without auth', async () => {
      const config = makeConfig({ baseDomains: ['example.com'] });
      const checker = new UpdateChecker(config);

      mockPull.mockImplementation(
        (_image: string, _opts: unknown, cb: (err: Error | null, stream: NodeJS.ReadableStream | undefined) => void) => {
          const { Readable } = require('node:stream');
          const stream = new Readable({ read() { this.push(null); } });
          cb(null, stream);
        }
      );
      mockFollowProgress.mockImplementation(
        (_stream: unknown, cb: (err: Error | null) => void) => cb(null)
      );

      await checker.pullImage('traefik:v3');

      expect(mockPull).toHaveBeenCalledWith(
        'traefik:v3',
        { authconfig: undefined },
        expect.any(Function)
      );
    });

    it('rejects when pull returns error', async () => {
      const config = makeConfig({ workerImagePrefix: 'ghcr.io/org/' });
      const checker = new UpdateChecker(config);

      mockPull.mockImplementation(
        (_image: string, _opts: unknown, cb: (err: Error | null, stream: NodeJS.ReadableStream | undefined) => void) => {
          cb(new Error('Pull failed'), undefined);
        }
      );

      await expect(checker.pullImage('ghcr.io/org/image:latest')).rejects.toThrow('Pull failed');
    });

    it('rejects when followProgress returns error', async () => {
      const config = makeConfig({ workerImagePrefix: 'ghcr.io/org/' });
      const checker = new UpdateChecker(config);

      mockPull.mockImplementation(
        (_image: string, _opts: unknown, cb: (err: Error | null, stream: NodeJS.ReadableStream | undefined) => void) => {
          const { Readable } = require('node:stream');
          const stream = new Readable({ read() { this.push(null); } });
          cb(null, stream);
        }
      );
      mockFollowProgress.mockImplementation(
        (_stream: unknown, cb: (err: Error | null) => void) => cb(new Error('Progress failed'))
      );

      await expect(checker.pullImage('ghcr.io/org/image:latest')).rejects.toThrow('Progress failed');
    });
  });

  describe('init', () => {
    it('starts polling in production mode', async () => {
      const config = makeConfig({ workerImagePrefix: 'ghcr.io/org/' });
      const checker = new UpdateChecker(config);

      fetchSpy.mockResolvedValue(new Response('{}', { status: 200 }));
      mockImageInspect.mockResolvedValue({ RepoDigests: [] });

      await checker.init();

      // Should have called check() at least once
      expect(fetchSpy).toHaveBeenCalled();
    });

    it('does not start polling in non-production mode', async () => {
      const config = makeConfig({ workerImagePrefix: '', baseDomains: [] });
      const checker = new UpdateChecker(config);

      mockImageInspect.mockResolvedValue({ RepoDigests: [] });
      await checker.init();

      // Should still populate local digests
      const status = checker.getStatus();
      expect(status.orchestrator).toBeDefined();
    });
  });

  describe('check — traefik only mode', () => {
    it('checks traefik when baseDomains set but no prefix', async () => {
      const config = makeConfig({
        workerImagePrefix: '',
        baseDomains: ['example.com'],
        traefikImage: 'traefik:v3',
      });
      const checker = new UpdateChecker(config);

      fetchSpy.mockImplementation(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('auth.docker.io/token')) {
          return new Response(JSON.stringify({ token: 'tok' }), { status: 200 });
        }
        if (url.includes('registry-1.docker.io/v2/library/traefik')) {
          return new Response('', { status: 200, headers: { 'docker-content-digest': 'sha256:remote-traefik' } });
        }
        return new Response('{}', { status: 200 });
      });

      mockImageInspect.mockResolvedValue({
        RepoDigests: ['docker.io/library/traefik@sha256:local-traefik'],
      });

      const status = await checker.check();
      // Orchestrator/mapper/worker should be null (no prefix)
      expect(status.orchestrator).toBeNull();
      expect(status.mapper).toBeNull();
      expect(status.worker).toBeNull();
      // Traefik should be checked
      expect(status.traefik).toBeDefined();
      expect(status.traefik?.updateAvailable).toBe(true);
    });
  });

  describe('applyUpdates — traefik', () => {
    it('pulls traefik image when update available', async () => {
      const config = makeConfig({ baseDomains: ['example.com'], traefikImage: 'traefik:v3' });
      const checker = new UpdateChecker(config);

      const status = checker.getStatus();
      status.traefik = {
        name: 'traefik:v3',
        localDigest: 'sha256:old',
        remoteDigest: 'sha256:new',
        updateAvailable: true,
        lastChecked: new Date().toISOString(),
      };

      mockPull.mockImplementation(
        (_image: string, _opts: unknown, cb: (err: Error | null, stream: NodeJS.ReadableStream | undefined) => void) => {
          const { Readable } = require('node:stream');
          const stream = new Readable({ read() { this.push(null); } });
          cb(null, stream);
        }
      );
      mockFollowProgress.mockImplementation(
        (_stream: unknown, cb: (err: Error | null) => void) => cb(null)
      );

      const result = await checker.applyUpdates(['traefik']);
      expect(result.traefikPulled).toBe(true);
      expect(result.workerPulled).toBe(false);
    });
  });

  describe('applyUpdates — orchestrator', () => {
    it('pulls orchestrator image when update available', async () => {
      const config = makeConfig({ workerImagePrefix: 'ghcr.io/org/' });
      const checker = new UpdateChecker(config);

      const status = checker.getStatus();
      status.orchestrator = {
        name: 'ghcr.io/org/agentor-orchestrator:latest',
        localDigest: 'sha256:old',
        remoteDigest: 'sha256:new',
        updateAvailable: true,
        lastChecked: new Date().toISOString(),
      };

      mockPull.mockImplementation(
        (_image: string, _opts: unknown, cb: (err: Error | null, stream: NodeJS.ReadableStream | undefined) => void) => {
          const { Readable } = require('node:stream');
          const stream = new Readable({ read() { this.push(null); } });
          cb(null, stream);
        }
      );
      mockFollowProgress.mockImplementation(
        (_stream: unknown, cb: (err: Error | null) => void) => cb(null)
      );

      const result = await checker.applyUpdates();
      expect(result.orchestratorPulled).toBe(true);
    });

    it('accumulates orchestrator pull errors', async () => {
      const config = makeConfig({ workerImagePrefix: 'ghcr.io/org/' });
      const checker = new UpdateChecker(config);

      const status = checker.getStatus();
      status.orchestrator = {
        name: 'ghcr.io/org/agentor-orchestrator:latest',
        localDigest: 'sha256:old',
        remoteDigest: 'sha256:new',
        updateAvailable: true,
        lastChecked: new Date().toISOString(),
      };

      mockPull.mockImplementation(
        (_image: string, _opts: unknown, cb: (err: Error | null, stream: NodeJS.ReadableStream | undefined) => void) => {
          cb(new Error('orch pull failed'), undefined);
        }
      );

      const result = await checker.applyUpdates();
      expect(result.orchestratorPulled).toBe(false);
      expect(result.errors).toContain('Orchestrator pull failed: orch pull failed');
    });
  });

  describe('recreateOrchestrator', () => {
    it('throws when HOSTNAME is not set', async () => {
      const config = makeConfig({ workerImagePrefix: 'ghcr.io/org/' });
      const checker = new UpdateChecker(config);

      const origHostname = process.env.HOSTNAME;
      delete process.env.HOSTNAME;

      await expect(checker.recreateOrchestrator()).rejects.toThrow('HOSTNAME not set');

      if (origHostname) process.env.HOSTNAME = origHostname;
    });

    it('creates replacement and swapper containers', async () => {
      const config = makeConfig({ workerImagePrefix: 'ghcr.io/org/' });
      const checker = new UpdateChecker(config);

      process.env.HOSTNAME = 'agentor-orchestrator-abc';

      mockContainerInspect.mockResolvedValueOnce({
        Name: '/agentor-orchestrator',
        Config: {
          Env: ['FOO=bar'],
          Labels: { app: 'agentor' },
          ExposedPorts: { '3000/tcp': {} },
        },
        HostConfig: { Binds: ['/data:/data'] },
        NetworkSettings: {
          Networks: {
            'agentor-net': { Aliases: ['orchestrator'] },
          },
        },
      });

      // First remove call (tempName) returns 404
      mockContainerRemove
        .mockRejectedValueOnce({ statusCode: 404 })
        .mockRejectedValueOnce({ statusCode: 404 });

      const mockSwapperStart = vi.fn().mockResolvedValue(undefined);
      mockCreateContainer
        .mockResolvedValueOnce({ id: 'new-orch-id', start: vi.fn() })
        .mockResolvedValueOnce({ id: 'swapper-id', start: mockSwapperStart });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await checker.recreateOrchestrator();

      expect(mockCreateContainer).toHaveBeenCalledTimes(2);
      expect(mockSwapperStart).toHaveBeenCalled();

      consoleSpy.mockRestore();
      delete process.env.HOSTNAME;
    });

    it('removes leftover containers from previous failed attempt', async () => {
      const config = makeConfig({ workerImagePrefix: 'ghcr.io/org/' });
      const checker = new UpdateChecker(config);

      process.env.HOSTNAME = 'agentor-orchestrator-def';

      mockContainerInspect.mockResolvedValueOnce({
        Name: '/agentor-orchestrator',
        Config: { Env: [], Labels: {}, ExposedPorts: {} },
        HostConfig: {},
        NetworkSettings: { Networks: {} },
      });

      // First remove succeeds (leftover temp), second succeeds (leftover swapper)
      mockContainerRemove
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      const mockSwapperStart = vi.fn().mockResolvedValue(undefined);
      mockCreateContainer
        .mockResolvedValueOnce({ id: 'new-id', start: vi.fn() })
        .mockResolvedValueOnce({ id: 'swapper-id', start: mockSwapperStart });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await checker.recreateOrchestrator();

      // Remove was called for both leftover containers
      expect(mockContainerRemove).toHaveBeenCalledTimes(2);

      consoleSpy.mockRestore();
      delete process.env.HOSTNAME;
    });
  });

  describe('getRemoteDigest', () => {
    it('returns empty string when fetch returns non-ok', async () => {
      const config = makeConfig({ workerImagePrefix: 'ghcr.io/org/' });
      const checker = new UpdateChecker(config);

      fetchSpy.mockImplementation(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('ghcr.io/token')) {
          return new Response(JSON.stringify({ token: 'tok' }), { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      });

      mockImageInspect.mockResolvedValue({ RepoDigests: [] });

      await checker.check();
      const status = checker.getStatus();
      // Remote digest should be empty since fetch returned 404
      expect(status.orchestrator?.remoteDigest).toBe('');
    });

    it('falls back to github token when no bearer token available', async () => {
      const config = makeConfig({
        workerImagePrefix: 'ghcr.io/org/',
        githubToken: 'ghp_direct',
      });
      const checker = new UpdateChecker(config);

      fetchSpy.mockImplementation(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('ghcr.io/token')) {
          // Token fetch fails
          return new Response('', { status: 401 });
        }
        if (url.includes('/v2/')) {
          return new Response('', {
            status: 200,
            headers: { 'docker-content-digest': 'sha256:fallback-digest' },
          });
        }
        return new Response('{}', { status: 200 });
      });

      mockImageInspect.mockResolvedValue({ RepoDigests: [] });

      await checker.check();

      // Verify the manifest fetch used the github token directly as fallback
      const manifestCall = fetchSpy.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('/v2/')
      );
      expect(manifestCall).toBeDefined();
      const headers = (manifestCall![1] as RequestInit)?.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer ghp_direct');
    });
  });

  describe('getRegistryToken', () => {
    it('returns empty string when GHCR token fetch fails', async () => {
      const config = makeConfig({
        workerImagePrefix: 'ghcr.io/org/',
        githubToken: 'ghp_test',
      });
      const checker = new UpdateChecker(config);

      fetchSpy.mockImplementation(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('ghcr.io/token')) {
          throw new Error('Network error');
        }
        if (url.includes('/v2/')) {
          return new Response('', {
            status: 200,
            headers: { 'docker-content-digest': 'sha256:abc' },
          });
        }
        return new Response('{}', { status: 200 });
      });

      mockImageInspect.mockResolvedValue({ RepoDigests: [] });
      await checker.check();

      // Should still proceed — uses fallback token
      const status = checker.getStatus();
      expect(status.orchestrator).toBeDefined();
    });

    it('returns empty string when Docker Hub token fetch throws', async () => {
      const config = makeConfig({
        baseDomains: ['example.com'],
        traefikImage: 'traefik:v3',
      });
      const checker = new UpdateChecker(config);

      fetchSpy.mockImplementation(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('auth.docker.io/token')) {
          throw new Error('Docker Hub down');
        }
        if (url.includes('/v2/')) {
          return new Response('', {
            status: 200,
            headers: { 'docker-content-digest': 'sha256:abc' },
          });
        }
        return new Response('{}', { status: 200 });
      });

      mockImageInspect.mockResolvedValue({ RepoDigests: [] });
      await checker.check();

      const status = checker.getStatus();
      expect(status.traefik).toBeDefined();
    });
  });

  describe('parseImageRef (bare name without tag)', () => {
    it('handles bare name without slash or tag', async () => {
      const config = makeConfig({
        baseDomains: ['example.com'],
        traefikImage: 'nginx',
      });
      const checker = new UpdateChecker(config);

      fetchSpy.mockImplementation(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('auth.docker.io/token')) {
          return new Response(JSON.stringify({ token: 'tok' }), { status: 200 });
        }
        if (url.includes('registry-1.docker.io/v2/library/nginx/manifests/latest')) {
          return new Response('', {
            status: 200,
            headers: { 'docker-content-digest': 'sha256:nginx-digest' },
          });
        }
        return new Response('{}', { status: 200 });
      });

      mockImageInspect.mockResolvedValue({ RepoDigests: [] });
      await checker.check();

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('registry-1.docker.io/v2/library/nginx/manifests/latest'),
        expect.anything()
      );
    });
  });
});
