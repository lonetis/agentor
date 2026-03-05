import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadConfig } from '../../utils/config';

describe('loadConfig', () => {
  beforeEach(() => {
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

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns all default values when no env vars set', () => {
    const config = loadConfig();
    expect(config.githubToken).toBe('');
    expect(config.anthropicApiKey).toBe('');
    expect(config.openaiApiKey).toBe('');
    expect(config.geminiApiKey).toBe('');
    expect(config.dockerNetwork).toBe('agentor-net');
    expect(config.containerPrefix).toBe('agentor-worker');
    expect(config.defaultCpuLimit).toBe(0);
    expect(config.defaultMemoryLimit).toBe('');
    expect(config.workerImage).toBe('agentor-worker:latest');
    expect(config.dataDir).toBe('/data');
    expect(config.baseDomains).toEqual([]);
    expect(config.dashboardBaseDomain).toBe('');
    expect(config.packageManagerDomains).toEqual([]);
  });

  it('parses GITHUB_TOKEN', () => {
    vi.stubEnv('GITHUB_TOKEN', 'ghp_abc123');
    expect(loadConfig().githubToken).toBe('ghp_abc123');
  });

  it('parses ANTHROPIC_API_KEY', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    expect(loadConfig().anthropicApiKey).toBe('sk-ant-test');
  });

  it('parses OPENAI_API_KEY', () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai-test');
    expect(loadConfig().openaiApiKey).toBe('sk-openai-test');
  });

  it('parses GEMINI_API_KEY', () => {
    vi.stubEnv('GEMINI_API_KEY', 'gem-key-test');
    expect(loadConfig().geminiApiKey).toBe('gem-key-test');
  });

  it('parses DEFAULT_CPU_LIMIT as float', () => {
    vi.stubEnv('DEFAULT_CPU_LIMIT', '2.5');
    expect(loadConfig().defaultCpuLimit).toBe(2.5);
  });

  it('parses DEFAULT_CPU_LIMIT "0" as 0', () => {
    vi.stubEnv('DEFAULT_CPU_LIMIT', '0');
    expect(loadConfig().defaultCpuLimit).toBe(0);
  });

  it('parses DEFAULT_MEMORY_LIMIT as string passthrough', () => {
    vi.stubEnv('DEFAULT_MEMORY_LIMIT', '4g');
    expect(loadConfig().defaultMemoryLimit).toBe('4g');
  });

  it('parses WORKER_IMAGE', () => {
    vi.stubEnv('WORKER_IMAGE', 'custom-worker:v2');
    expect(loadConfig().workerImage).toBe('custom-worker:v2');
  });

  it('parses BASE_DOMAINS comma-separated', () => {
    vi.stubEnv('BASE_DOMAINS', 'a.com,b.com');
    expect(loadConfig().baseDomains).toEqual(['a.com', 'b.com']);
  });

  it('filters empty/whitespace domains', () => {
    vi.stubEnv('BASE_DOMAINS', 'a.com, , b.com, ');
    expect(loadConfig().baseDomains).toEqual(['a.com', 'b.com']);
  });

  it('DASHBOARD_BASE_DOMAIN falls back to first baseDomain', () => {
    vi.stubEnv('BASE_DOMAINS', 'first.com,second.com');
    const config = loadConfig();
    expect(config.dashboardBaseDomain).toBe('first.com');
  });

  it('DASHBOARD_BASE_DOMAIN must be in baseDomains list, otherwise uses first', () => {
    vi.stubEnv('BASE_DOMAINS', 'first.com,second.com');
    vi.stubEnv('DASHBOARD_BASE_DOMAIN', 'other.com');
    expect(loadConfig().dashboardBaseDomain).toBe('first.com');
  });

  it('DASHBOARD_BASE_DOMAIN uses specified value when in baseDomains', () => {
    vi.stubEnv('BASE_DOMAINS', 'first.com,second.com');
    vi.stubEnv('DASHBOARD_BASE_DOMAIN', 'second.com');
    expect(loadConfig().dashboardBaseDomain).toBe('second.com');
  });

  it('parses PACKAGE_MANAGER_DOMAINS comma-separated', () => {
    vi.stubEnv('PACKAGE_MANAGER_DOMAINS', 'npm.org,pypi.org,crates.io');
    expect(loadConfig().packageManagerDomains).toEqual(['npm.org', 'pypi.org', 'crates.io']);
  });

  it('empty PACKAGE_MANAGER_DOMAINS returns empty array', () => {
    vi.stubEnv('PACKAGE_MANAGER_DOMAINS', '');
    expect(loadConfig().packageManagerDomains).toEqual([]);
  });

  it('DOCKER_NETWORK defaults to agentor-net', () => {
    expect(loadConfig().dockerNetwork).toBe('agentor-net');
  });

  it('CONTAINER_PREFIX defaults to agentor-worker', () => {
    expect(loadConfig().containerPrefix).toBe('agentor-worker');
  });

  it('DATA_DIR defaults to /data', () => {
    expect(loadConfig().dataDir).toBe('/data');
  });
});
