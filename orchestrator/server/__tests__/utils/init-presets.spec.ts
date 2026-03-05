import { describe, it, expect } from 'vitest';
import { listInitPresets, getAllApiDomains, getAllAgentEnvVars } from '../../utils/init-presets';
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

describe('init-presets', () => {
  describe('listInitPresets', () => {
    it('returns array with claude, codex, gemini', () => {
      const presets = listInitPresets();
      const ids = presets.map((p) => p.id);
      expect(ids).toContain('claude');
      expect(ids).toContain('codex');
      expect(ids).toContain('gemini');
    });

    it('each preset has required fields', () => {
      for (const preset of listInitPresets()) {
        expect(preset.id).toBeTruthy();
        expect(preset.displayName).toBeTruthy();
        expect(preset.script).toBeTruthy();
        expect(preset.apiDomains).toBeInstanceOf(Array);
        expect(preset.envVars).toBeDefined();
      }
    });
  });

  describe('preset scripts', () => {
    it('Claude preset script contains claude', () => {
      const claude = listInitPresets().find((p) => p.id === 'claude')!;
      expect(claude.script).toContain('claude');
    });

    it('Codex preset script contains codex', () => {
      const codex = listInitPresets().find((p) => p.id === 'codex')!;
      expect(codex.script).toContain('codex');
    });

    it('Gemini preset script contains gemini', () => {
      const gemini = listInitPresets().find((p) => p.id === 'gemini')!;
      expect(gemini.script).toContain('gemini');
    });
  });

  describe('getAllApiDomains', () => {
    it('returns deduplicated union', () => {
      const domains = getAllApiDomains();
      const unique = new Set(domains);
      expect(domains.length).toBe(unique.size);
    });

    it('includes api.anthropic.com', () => {
      expect(getAllApiDomains()).toContain('api.anthropic.com');
    });

    it('includes api.openai.com', () => {
      expect(getAllApiDomains()).toContain('api.openai.com');
    });
  });

  describe('getAllAgentEnvVars', () => {
    it('returns empty array when no config values set', () => {
      const vars = getAllAgentEnvVars(makeConfig());
      expect(vars).toEqual([]);
    });

    it('returns ANTHROPIC_API_KEY=xxx when config has anthropicApiKey', () => {
      const vars = getAllAgentEnvVars(makeConfig({ anthropicApiKey: 'xxx' }));
      expect(vars).toContain('ANTHROPIC_API_KEY=xxx');
    });

    it('deduplicates env var names', () => {
      const vars = getAllAgentEnvVars(makeConfig({
        anthropicApiKey: 'key1',
        openaiApiKey: 'key2',
      }));
      const names = vars.map((v) => v.split('=')[0]);
      const unique = new Set(names);
      expect(names.length).toBe(unique.size);
    });

    it('skips falsy config values', () => {
      const vars = getAllAgentEnvVars(makeConfig({
        anthropicApiKey: 'set',
        openaiApiKey: '',
        geminiApiKey: '',
      }));
      expect(vars).toHaveLength(1);
      expect(vars[0]).toBe('ANTHROPIC_API_KEY=set');
    });
  });
});
