export type ChallengeType = 'none' | 'http' | 'dns' | 'selfsigned';

export interface BaseDomainConfig {
  domain: string;
  challengeType: ChallengeType;
  dnsProvider?: string;
}

export interface DnsProviderConfig {
  provider: string;
  envVarNames: string[];
  delay: number;
  resolvers: string[];
}

export interface Config {
  dockerNetwork: string;
  containerPrefix: string;
  defaultCpuLimit: number;
  defaultMemoryLimit: string;
  workerImage: string;
  dataVolume: string;
  orchestratorImage: string;
  workerImagePrefix: string;
  packageManagerDomains: string[];
  dataDir: string;
  baseDomains: string[];
  baseDomainConfigs: BaseDomainConfig[];
  dnsProviderConfigs: Record<string, DnsProviderConfig>;
  dashboardBaseDomain: string;
  dashboardSubdomain: string;
  acmeEmail: string;
  traefikImage: string;
  dashboardAuthUser: string;
  dashboardAuthPassword: string;
  logLevel: import('../../shared/types').LogLevel;
  logMaxSize: number;
  logMaxFiles: number;
  betterAuthSecret: string;
  betterAuthUrl: string;
  betterAuthTrustedOrigins: string[];
  betterAuthRpId: string;
}

function parseLogSize(raw: string): number {
  const match = raw.trim().match(/^(\d+(?:\.\d+)?)\s*([kmg])?$/i);
  if (!match) return 50 * 1024 * 1024;
  const num = parseFloat(match[1]!);
  const unit = (match[2] || '').toLowerCase();
  if (unit === 'k') return Math.floor(num * 1024);
  if (unit === 'g') return Math.floor(num * 1024 * 1024 * 1024);
  return Math.floor(num * 1024 * 1024); // default: megabytes
}

function parseBaseDomains(raw: string): BaseDomainConfig[] {
  return raw.split(',').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const parts = entry.split(':');
    const domain = parts[0]!;
    if (parts.length >= 3 && parts[1] === 'dns') {
      return { domain, challengeType: 'dns' as ChallengeType, dnsProvider: parts[2]! };
    }
    if (parts.length >= 2 && parts[1] === 'http') {
      return { domain, challengeType: 'http' as ChallengeType };
    }
    if (parts.length >= 2 && parts[1] === 'selfsigned') {
      return { domain, challengeType: 'selfsigned' as ChallengeType };
    }
    return { domain, challengeType: 'none' as ChallengeType };
  });
}

function parseDnsProviderConfigs(baseDomainConfigs: BaseDomainConfig[]): Record<string, DnsProviderConfig> {
  const providers = new Set<string>();
  for (const c of baseDomainConfigs) {
    if (c.challengeType === 'dns' && c.dnsProvider) providers.add(c.dnsProvider);
  }

  const configs: Record<string, DnsProviderConfig> = {};
  for (const provider of providers) {
    const upper = provider.toUpperCase().replace(/-/g, '_');
    const varsEnv = process.env[`ACME_DNS_${upper}_VARS`]?.trim() || '';
    if (!varsEnv) {
      // Logger may not be initialized yet during config loading — use console for this early warning
      console.warn(`[config] DNS provider '${provider}' used in BASE_DOMAINS but ACME_DNS_${upper}_VARS is not set`);
    }
    const delayEnv = process.env[`ACME_DNS_${upper}_DELAY`]?.trim() || '';
    const resolversEnv = process.env[`ACME_DNS_${upper}_RESOLVERS`]?.trim() || '';

    configs[provider] = {
      provider,
      envVarNames: varsEnv ? varsEnv.split(',').map((v) => v.trim()).filter(Boolean) : [],
      delay: delayEnv ? parseInt(delayEnv, 10) || 0 : 0,
      resolvers: resolversEnv ? resolversEnv.split(',').map((r) => r.trim()).filter(Boolean) : [],
    };
  }
  return configs;
}

export function loadConfig(): Config {
  const pmDomainsEnv = process.env.PACKAGE_MANAGER_DOMAINS?.trim();

  const baseDomainConfigs = parseBaseDomains(process.env.BASE_DOMAINS || '');
  const baseDomains = baseDomainConfigs.map((c) => c.domain);
  const dnsProviderConfigs = parseDnsProviderConfigs(baseDomainConfigs);

  const dashboardBaseDomainEnv = process.env.DASHBOARD_BASE_DOMAIN?.trim() || '';
  const dashboardBaseDomain = dashboardBaseDomainEnv && baseDomains.includes(dashboardBaseDomainEnv)
    ? dashboardBaseDomainEnv
    : baseDomains[0] || '';

  return {
    dockerNetwork: process.env.DOCKER_NETWORK || 'agentor-net',
    containerPrefix: process.env.CONTAINER_PREFIX || 'agentor-worker',
    defaultCpuLimit: parseFloat(process.env.DEFAULT_CPU_LIMIT || '0'),
    defaultMemoryLimit: process.env.DEFAULT_MEMORY_LIMIT || '',
    workerImage: process.env.WORKER_IMAGE || 'agentor-worker:latest',
    dataVolume: process.env.DATA_VOLUME || './data',
    orchestratorImage: process.env.ORCHESTRATOR_IMAGE || 'agentor-orchestrator:latest',
    workerImagePrefix: process.env.WORKER_IMAGE_PREFIX || '',
    packageManagerDomains: pmDomainsEnv
      ? pmDomainsEnv.split(',').map((d) => d.trim()).filter(Boolean)
      : [],
    dataDir: process.env.DATA_DIR || '/data',
    baseDomains,
    baseDomainConfigs,
    dnsProviderConfigs,
    dashboardBaseDomain,
    dashboardSubdomain: process.env.DASHBOARD_SUBDOMAIN || '',
    acmeEmail: process.env.ACME_EMAIL || '',
    traefikImage: process.env.TRAEFIK_IMAGE || 'traefik:v3',
    dashboardAuthUser: process.env.DASHBOARD_AUTH_USER || '',
    dashboardAuthPassword: process.env.DASHBOARD_AUTH_PASSWORD || '',
    logLevel: (process.env.LOG_LEVEL || 'info') as import('../../shared/types').LogLevel,
    logMaxSize: parseLogSize(process.env.LOG_MAX_SIZE || '50m'),
    logMaxFiles: parseInt(process.env.LOG_MAX_FILES || '5', 10) || 5,
    betterAuthSecret: process.env.BETTER_AUTH_SECRET || '',
    betterAuthUrl: process.env.BETTER_AUTH_URL || '',
    betterAuthTrustedOrigins: process.env.BETTER_AUTH_TRUSTED_ORIGINS
      ? process.env.BETTER_AUTH_TRUSTED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
      : [],
    betterAuthRpId: process.env.BETTER_AUTH_RP_ID?.trim() || '',
  };
}
