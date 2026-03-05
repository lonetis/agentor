import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Config } from '../../utils/config';

// --- Mock node:fs/promises ---
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn().mockResolvedValue(undefined);

vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

import { UsageChecker } from '../../utils/usage-checker';

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

describe('UsageChecker', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 })
    );
    // Default: no credential files
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('detectAuthType', () => {
    it('returns oauth when token present', async () => {
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes('claude.json')) {
          return JSON.stringify({ claudeAiOauth: { accessToken: 'tok123' } });
        }
        return '{}';
      });

      const checker = new UsageChecker(makeConfig());
      // fetchAll is private, but we can trigger it via init-like behavior
      // Actually, let's just call getStatus after init
      fetchSpy.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

      // We need to trigger fetchAll — the simplest way is to access the private method
      // but we can also just check the output after calling init
      // Since init calls fetchAll, let's just not start the interval
      await (checker as any).fetchAll();
      const status = checker.getStatus();
      const claude = status.agents.find((a) => a.agentId === 'claude');
      expect(claude?.authType).toBe('oauth');
    });

    it('returns api-key when config has key but no oauth', async () => {
      mockReadFile.mockImplementation(async () => '{}');

      const checker = new UsageChecker(makeConfig({ anthropicApiKey: 'sk-ant-test' }));
      await (checker as any).fetchAll();
      const status = checker.getStatus();
      const claude = status.agents.find((a) => a.agentId === 'claude');
      expect(claude?.authType).toBe('api-key');
    });

    it('returns none when neither', async () => {
      mockReadFile.mockImplementation(async () => '{}');

      const checker = new UsageChecker(makeConfig());
      await (checker as any).fetchAll();
      const status = checker.getStatus();
      const claude = status.agents.find((a) => a.agentId === 'claude');
      expect(claude?.authType).toBe('none');
    });
  });

  describe('Claude', () => {
    it('no token returns base with authType', async () => {
      mockReadFile.mockImplementation(async () => '{}');

      const checker = new UsageChecker(makeConfig());
      await (checker as any).fetchAll();
      const claude = checker.getStatus().agents.find((a) => a.agentId === 'claude')!;
      expect(claude.usageAvailable).toBe(false);
      expect(claude.windows).toEqual([]);
    });

    it('valid response parses five_hour, seven_day, seven_day_sonnet windows', async () => {
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes('claude.json')) {
          return JSON.stringify({ claudeAiOauth: { accessToken: 'tok' } });
        }
        return '{}';
      });

      fetchSpy.mockImplementation(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('api.anthropic.com/api/oauth/usage')) {
          return new Response(JSON.stringify({
            five_hour: { utilization: 25, resets_at: '2024-01-01T05:00:00Z' },
            seven_day: { utilization: 50, resets_at: '2024-01-07T00:00:00Z' },
            seven_day_sonnet: { utilization: 10, resets_at: '2024-01-07T00:00:00Z' },
          }), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });

      const checker = new UsageChecker(makeConfig());
      await (checker as any).fetchAll();
      const claude = checker.getStatus().agents.find((a) => a.agentId === 'claude')!;
      expect(claude.usageAvailable).toBe(true);
      expect(claude.windows).toHaveLength(3);
      expect(claude.windows[0]).toEqual({ label: 'Session', utilization: 25, resetsAt: '2024-01-01T05:00:00Z' });
      expect(claude.windows[1]).toEqual({ label: 'Weekly', utilization: 50, resetsAt: '2024-01-07T00:00:00Z' });
      expect(claude.windows[2]).toEqual({ label: 'Sonnet', utilization: 10, resetsAt: '2024-01-07T00:00:00Z' });
    });

    it('HTTP error sets error field', async () => {
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes('claude.json')) {
          return JSON.stringify({ claudeAiOauth: { accessToken: 'tok' } });
        }
        return '{}';
      });

      fetchSpy.mockImplementation(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('api.anthropic.com')) {
          return new Response('', { status: 429 });
        }
        return new Response('{}', { status: 200 });
      });

      const checker = new UsageChecker(makeConfig());
      await (checker as any).fetchAll();
      const claude = checker.getStatus().agents.find((a) => a.agentId === 'claude')!;
      expect(claude.error).toBe('HTTP 429');
    });
  });

  describe('Codex', () => {
    it('no token returns base', async () => {
      mockReadFile.mockImplementation(async () => '{}');

      const checker = new UsageChecker(makeConfig());
      await (checker as any).fetchAll();
      const codex = checker.getStatus().agents.find((a) => a.agentId === 'codex')!;
      expect(codex.usageAvailable).toBe(false);
    });

    it('valid response parses primary_window, secondary_window', async () => {
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes('codex.json')) {
          return JSON.stringify({
            tokens: { access_token: 'tok', refresh_token: 'ref' },
            last_refresh: new Date().toISOString(),
          });
        }
        return '{}';
      });

      fetchSpy.mockImplementation(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('chatgpt.com/backend-api/wham/usage')) {
          return new Response(JSON.stringify({
            plan_type: 'plus',
            rate_limit: {
              primary_window: { used_percent: 30, reset_at: 1704067200, limit_window_seconds: 3600 },
              secondary_window: { used_percent: 15, reset_at: 1704672000, limit_window_seconds: 604800 },
            },
          }), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });

      const checker = new UsageChecker(makeConfig());
      await (checker as any).fetchAll();
      const codex = checker.getStatus().agents.find((a) => a.agentId === 'codex')!;
      expect(codex.usageAvailable).toBe(true);
      expect(codex.planType).toBe('plus');
      expect(codex.windows).toHaveLength(2);
      expect(codex.windows[0].label).toBe('Session');
      expect(codex.windows[0].utilization).toBe(30);
      expect(codex.windows[1].label).toBe('Weekly');
    });

    it('credits with has_credits adds Reserve window', async () => {
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes('codex.json')) {
          return JSON.stringify({
            tokens: { access_token: 'tok' },
            last_refresh: new Date().toISOString(),
          });
        }
        return '{}';
      });

      fetchSpy.mockImplementation(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('chatgpt.com/backend-api/wham/usage')) {
          return new Response(JSON.stringify({
            rate_limit: {},
            credits: { has_credits: true, balance: '42.50' },
          }), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });

      const checker = new UsageChecker(makeConfig());
      await (checker as any).fetchAll();
      const codex = checker.getStatus().agents.find((a) => a.agentId === 'codex')!;
      const reserve = codex.windows.find((w) => w.label === 'Reserve');
      expect(reserve).toBeDefined();
      expect(reserve!.utilization).toBe(42.50);
    });

    it('token refresh when last_refresh > 8 days old', async () => {
      const oldDate = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString();
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes('codex.json')) {
          return JSON.stringify({
            tokens: { access_token: 'old-tok', refresh_token: 'ref-tok' },
            last_refresh: oldDate,
          });
        }
        return '{}';
      });

      fetchSpy.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('auth.openai.com/oauth/token')) {
          return new Response(JSON.stringify({
            access_token: 'new-tok',
            refresh_token: 'new-ref',
          }), { status: 200 });
        }
        if (url.includes('chatgpt.com/backend-api/wham/usage')) {
          return new Response(JSON.stringify({ rate_limit: {} }), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });

      const checker = new UsageChecker(makeConfig());
      await (checker as any).fetchAll();

      // Should have called the token refresh endpoint
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://auth.openai.com/oauth/token',
        expect.objectContaining({ method: 'POST' })
      );
      // Should have written updated tokens
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('codex.json'),
        expect.stringContaining('new-tok')
      );
    });

    it('token refresh failure sets error', async () => {
      const oldDate = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString();
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes('codex.json')) {
          return JSON.stringify({
            tokens: { access_token: 'old-tok', refresh_token: 'ref-tok' },
            last_refresh: oldDate,
          });
        }
        return '{}';
      });

      fetchSpy.mockImplementation(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('auth.openai.com/oauth/token')) {
          return new Response('', { status: 401 });
        }
        return new Response('{}', { status: 200 });
      });

      const checker = new UsageChecker(makeConfig());
      await (checker as any).fetchAll();
      const codex = checker.getStatus().agents.find((a) => a.agentId === 'codex')!;
      expect(codex.error).toContain('Token refresh failed');
    });
  });

  describe('Gemini', () => {
    it('no token returns base', async () => {
      mockReadFile.mockImplementation(async () => '{}');

      const checker = new UsageChecker(makeConfig());
      await (checker as any).fetchAll();
      const gemini = checker.getStatus().agents.find((a) => a.agentId === 'gemini')!;
      expect(gemini.usageAvailable).toBe(false);
    });

    it('expired token returns error message', async () => {
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes('gemini.json')) {
          return JSON.stringify({
            access_token: 'tok',
            expiry_date: Date.now() - 60000, // expired
          });
        }
        return '{}';
      });

      const checker = new UsageChecker(makeConfig());
      await (checker as any).fetchAll();
      const gemini = checker.getStatus().agents.find((a) => a.agentId === 'gemini')!;
      expect(gemini.error).toContain('Token expired');
    });

    it('valid response groups buckets by model family', async () => {
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes('gemini.json')) {
          return JSON.stringify({
            access_token: 'tok',
            expiry_date: Date.now() + 3600000,
          });
        }
        return '{}';
      });

      fetchSpy.mockImplementation(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('cloudcode-pa.googleapis.com')) {
          return new Response(JSON.stringify({
            buckets: [
              { modelId: 'gemini-2.0-pro', remainingFraction: 0.7, resetTime: '2024-01-02T00:00:00Z' },
              { modelId: 'gemini-2.0-flash', remainingFraction: 0.9, resetTime: '2024-01-02T00:00:00Z' },
            ],
          }), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });

      const checker = new UsageChecker(makeConfig());
      await (checker as any).fetchAll();
      const gemini = checker.getStatus().agents.find((a) => a.agentId === 'gemini')!;
      expect(gemini.usageAvailable).toBe(true);
      expect(gemini.windows).toHaveLength(2);
    });

    it('Pro sorts before Flash', async () => {
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes('gemini.json')) {
          return JSON.stringify({
            access_token: 'tok',
            expiry_date: Date.now() + 3600000,
          });
        }
        return '{}';
      });

      fetchSpy.mockImplementation(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('cloudcode-pa.googleapis.com')) {
          return new Response(JSON.stringify({
            buckets: [
              { modelId: 'gemini-flash-2', remainingFraction: 0.9, resetTime: '2024-01-02T00:00:00Z' },
              { modelId: 'gemini-pro-2', remainingFraction: 0.5, resetTime: '2024-01-02T00:00:00Z' },
            ],
          }), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });

      const checker = new UsageChecker(makeConfig());
      await (checker as any).fetchAll();
      const gemini = checker.getStatus().agents.find((a) => a.agentId === 'gemini')!;
      expect(gemini.windows[0].label).toBe('Pro');
      expect(gemini.windows[1].label).toBe('Flash');
    });
  });

  describe('fetchAll', () => {
    it('returns all three agents', async () => {
      mockReadFile.mockImplementation(async () => '{}');

      const checker = new UsageChecker(makeConfig());
      await (checker as any).fetchAll();
      const status = checker.getStatus();
      expect(status.agents).toHaveLength(3);
      expect(status.agents.map((a) => a.agentId)).toEqual(['claude', 'codex', 'gemini']);
    });
  });
});
