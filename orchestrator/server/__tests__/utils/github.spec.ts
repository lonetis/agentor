import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Config } from '../../utils/config';

// Mock createError (Nitro/h3 global)
vi.stubGlobal('createError', (opts: { statusCode: number; statusMessage: string }) => {
  const err = new Error(opts.statusMessage) as Error & { statusCode: number };
  err.statusCode = opts.statusCode;
  return err;
});

import { GitHubService } from '../../utils/github';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    githubToken: 'ghp_testtoken123',
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

describe('GitHubService', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let service: GitHubService;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    service = new GitHubService(makeConfig());
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('hasToken', () => {
    it('returns true when token set', () => {
      expect(service.hasToken).toBe(true);
    });

    it('returns false when empty', () => {
      const emptyService = new GitHubService(makeConfig({ githubToken: '' }));
      expect(emptyService.hasToken).toBe(false);
    });
  });

  describe('parseNextLink', () => {
    // parseNextLink is private, but we can test it indirectly via pagination behavior

    it('extracts URL from link header', async () => {
      // First page returns data + link header
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify([
          { full_name: 'user/repo1', private: false, default_branch: 'main' },
        ]), {
          status: 200,
          headers: { link: '<https://api.github.com/user/repos?page=2>; rel="next"' },
        })
      );
      // Second page returns data + no link header
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify([
          { full_name: 'user/repo2', private: true, default_branch: 'master' },
        ]), { status: 200 })
      );

      const repos = await service.listRepos();
      expect(repos).toHaveLength(2);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('returns null for no header (no pagination)', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify([
          { full_name: 'user/repo1', private: false, default_branch: 'main' },
        ]), { status: 200 })
      );

      const repos = await service.listRepos();
      expect(repos).toHaveLength(1);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('returns null for non-next link', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify([
          { full_name: 'user/repo1', private: false, default_branch: 'main' },
        ]), {
          status: 200,
          headers: { link: '<https://api.github.com/user/repos?page=1>; rel="prev"' },
        })
      );

      const repos = await service.listRepos();
      expect(repos).toHaveLength(1);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('listRepos', () => {
    it('fetches and maps response', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify([
          { full_name: 'org/repo', private: true, default_branch: 'develop' },
        ]), { status: 200 })
      );

      const repos = await service.listRepos();
      expect(repos).toEqual([
        { fullName: 'org/repo', private: true, defaultBranch: 'develop' },
      ]);
    });

    it('uses cache on second call within TTL', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify([
          { full_name: 'org/repo', private: false, default_branch: 'main' },
        ]), { status: 200 })
      );

      const repos1 = await service.listRepos();
      const repos2 = await service.listRepos();
      expect(repos1).toEqual(repos2);
      // Only one fetch call — second was cached
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('refetches after TTL expires', async () => {
      vi.useFakeTimers();

      fetchSpy.mockImplementation(async () =>
        new Response(JSON.stringify([
          { full_name: 'org/repo', private: false, default_branch: 'main' },
        ]), { status: 200 })
      );

      await service.listRepos();
      // Advance past the 60s TTL
      vi.advanceTimersByTime(61_000);
      await service.listRepos();

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });
  });

  describe('createRepo', () => {
    it('posts to user endpoint for personal repos', async () => {
      // Mock getUser
      fetchSpy
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ login: 'myuser' }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({
            full_name: 'myuser/new-repo',
            private: true,
            default_branch: 'main',
          }), { status: 201 })
        );

      const repo = await service.createRepo('myuser', 'new-repo', true);
      expect(repo.fullName).toBe('myuser/new-repo');

      // Second fetch call should be to /user/repos
      const createCall = fetchSpy.mock.calls[1];
      expect(createCall[0]).toBe('https://api.github.com/user/repos');
    });

    it('posts to org endpoint for org repos', async () => {
      // Mock getUser (returns different login than owner)
      fetchSpy
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ login: 'myuser' }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({
            full_name: 'myorg/new-repo',
            private: false,
            default_branch: 'main',
          }), { status: 201 })
        );

      const repo = await service.createRepo('myorg', 'new-repo', false);
      expect(repo.fullName).toBe('myorg/new-repo');

      const createCall = fetchSpy.mock.calls[1];
      expect(createCall[0]).toBe('https://api.github.com/orgs/myorg/repos');
    });

    it('invalidates repos cache', async () => {
      // Pre-populate cache
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify([
          { full_name: 'user/existing', private: false, default_branch: 'main' },
        ]), { status: 200 })
      );
      await service.listRepos();

      // Mock getUser + createRepo
      fetchSpy
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ login: 'user' }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({
            full_name: 'user/new',
            private: false,
            default_branch: 'main',
          }), { status: 201 })
        );
      await service.createRepo('user', 'new', false);

      // Now listing repos should re-fetch (cache invalidated)
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify([
          { full_name: 'user/existing', private: false, default_branch: 'main' },
          { full_name: 'user/new', private: false, default_branch: 'main' },
        ]), { status: 200 })
      );
      const repos = await service.listRepos();
      // Should have fetched again (4 total: listRepos, getUser, createRepo, listRepos)
      expect(fetchSpy).toHaveBeenCalledTimes(4);
      expect(repos).toHaveLength(2);
    });
  });

  describe('listBranches', () => {
    it('fetches repo info + branches', async () => {
      // Mock repo info
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ default_branch: 'main' }), { status: 200 })
      );
      // Mock branches list
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify([
          { name: 'main' },
          { name: 'develop' },
        ]), { status: 200 })
      );

      const result = await service.listBranches('owner', 'repo');
      expect(result.defaultBranch).toBe('main');
      expect(result.branches).toEqual([{ name: 'main' }, { name: 'develop' }]);
    });
  });

  describe('pagination', () => {
    it('follows next links', async () => {
      fetchSpy
        .mockResolvedValueOnce(
          new Response(JSON.stringify([
            { full_name: 'user/repo1', private: false, default_branch: 'main' },
          ]), {
            status: 200,
            headers: { link: '<https://api.github.com/user/repos?page=2>; rel="next"' },
          })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify([
            { full_name: 'user/repo2', private: false, default_branch: 'main' },
          ]), {
            status: 200,
            headers: { link: '<https://api.github.com/user/repos?page=3>; rel="next"' },
          })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify([
            { full_name: 'user/repo3', private: false, default_branch: 'main' },
          ]), { status: 200 })
        );

      const repos = await service.listRepos();
      expect(repos).toHaveLength(3);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });
  });
});
