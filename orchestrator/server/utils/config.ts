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

/** A self-managed GitLab server offered as an additional git provider
 * (`GITLAB_INSTANCES`). gitlab.com is built in and never listed here. */
export interface GitLabInstanceConfig {
  /** Admin-chosen short name: provider id `gitlab-<name>`, per-user token env
   * var `GITLAB_<NAME>_TOKEN`. */
  name: string;
  /** Web base URL without a trailing slash — may carry a relative URL root
   * (`https://example.com/gitlab`). The API lives at `<url>/api/v4`. */
  url: string;
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
  /** `managed` (default): the orchestrator runs its own Traefik container.
   * `external`: an existing reverse proxy routes traffic. The orchestrator keeps
   * writing the Traefik dynamic config (`traefik-config.yml`) for it, but never
   * creates, starts or removes a Traefik container and never binds host ports. */
  traefikMode: 'managed' | 'external';
  dashboardAuthUser: string;
  dashboardAuthPassword: string;
  logLevel: import('../../shared/types').LogLevel;
  logMaxSize: number;
  logMaxFiles: number;
  betterAuthSecret: string;
  betterAuthUrl: string;
  betterAuthTrustedOrigins: string[];
  betterAuthRpId: string;
  /** Canonical public URL of the dashboard: `BETTER_AUTH_URL`, else the Traefik
   * dashboard URL, else `http://localhost:3000`. It is better-auth's `baseURL`,
   * so it is also the OAuth issuer and the origin of the MCP resource URL —
   * MCP clients must reach the orchestrator under exactly this URL. */
  publicBaseUrl: string;
  mcpEnabled: boolean;
  gitlabInstances: GitLabInstanceConfig[];
}

const DEFAULT_LOG_MAX_SIZE = 50 * 1024 * 1024;

function parseLogSize(raw: string): number {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*([kmg])?$/i);
  if (!match) {
    if (trimmed) {
      // Logger may not be initialized yet during config loading — mirror the
      // DNS-provider warning and surface the misconfig instead of silently
      // falling back to the default.
      console.warn(`[config] LOG_MAX_SIZE='${trimmed}' is not parseable (expected e.g. 50m, 512k, 1g) — falling back to 50m`);
    }
    return DEFAULT_LOG_MAX_SIZE;
  }
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

/** See `Config.publicBaseUrl`. The dashboard URL uses https unless its base
 * domain is configured without TLS (challenge type `none`). */
function resolvePublicBaseUrl(
  betterAuthUrl: string,
  dashboardSubdomain: string,
  dashboardBaseDomain: string,
  baseDomainConfigs: BaseDomainConfig[],
): string {
  if (betterAuthUrl) return betterAuthUrl.replace(/\/+$/, '');
  if (dashboardSubdomain && dashboardBaseDomain) {
    const challenge = baseDomainConfigs.find((c) => c.domain === dashboardBaseDomain)?.challengeType;
    const scheme = challenge === 'none' ? 'http' : 'https';
    return `${scheme}://${dashboardSubdomain}.${dashboardBaseDomain}`;
  }
  return 'http://localhost:3000';
}

const GITLAB_INSTANCE_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Parses `GITLAB_INSTANCES` (`<name>=<url>`, comma-separated). Malformed or
 * duplicate entries are skipped with a warning rather than failing startup —
 * one bad entry should not take the dashboard down. */
export function parseGitLabInstances(raw: string): GitLabInstanceConfig[] {
  const instances: GitLabInstanceConfig[] = [];
  for (const entry of raw.split(',').map((e) => e.trim()).filter(Boolean)) {
    const eq = entry.indexOf('=');
    const name = eq > 0 ? entry.slice(0, eq).trim().toLowerCase() : '';
    const url = eq > 0 ? normalizeInstanceUrl(entry.slice(eq + 1).trim()) : null;

    let problem = '';
    if (!GITLAB_INSTANCE_NAME_RE.test(name)) problem = 'expected <name>=<url> with a name of lowercase letters, digits and dashes';
    else if (!url) problem = 'the URL must be an absolute http(s) URL without credentials, query or fragment';
    else if (new URL(url).hostname === 'gitlab.com') problem = 'gitlab.com is built in';
    else if (instances.some((i) => i.name === name)) problem = `duplicate name "${name}"`;
    else if (instances.some((i) => i.url === url)) problem = `duplicate URL ${url}`;

    if (problem) {
      // Logger may not be initialized yet during config loading.
      console.warn(`[config] GITLAB_INSTANCES entry '${entry}' ignored: ${problem}`);
      continue;
    }
    instances.push({ name, url: url! });
  }
  return instances;
}

function normalizeInstanceUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

export function parseTraefikMode(value: string | undefined): 'managed' | 'external' {
  const mode = (value || '').trim().toLowerCase();
  if (mode === '' || mode === 'managed') return 'managed';
  if (mode === 'external') return 'external';
  throw new Error(`TRAEFIK_MODE must be "managed" or "external", got "${value}"`);
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

  const betterAuthUrl = process.env.BETTER_AUTH_URL?.trim() || '';
  const dashboardSubdomain = process.env.DASHBOARD_SUBDOMAIN || '';

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
    dashboardSubdomain,
    acmeEmail: process.env.ACME_EMAIL || '',
    traefikImage: process.env.TRAEFIK_IMAGE || 'traefik:v3',
    traefikMode: parseTraefikMode(process.env.TRAEFIK_MODE),
    dashboardAuthUser: process.env.DASHBOARD_AUTH_USER || '',
    dashboardAuthPassword: process.env.DASHBOARD_AUTH_PASSWORD || '',
    logLevel: (process.env.LOG_LEVEL || 'info') as import('../../shared/types').LogLevel,
    logMaxSize: parseLogSize(process.env.LOG_MAX_SIZE || '50m'),
    logMaxFiles: parseInt(process.env.LOG_MAX_FILES || '5', 10) || 5,
    betterAuthSecret: process.env.BETTER_AUTH_SECRET || '',
    betterAuthUrl,
    betterAuthTrustedOrigins: process.env.BETTER_AUTH_TRUSTED_ORIGINS
      ? process.env.BETTER_AUTH_TRUSTED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
      : [],
    betterAuthRpId: process.env.BETTER_AUTH_RP_ID?.trim() || '',
    publicBaseUrl: resolvePublicBaseUrl(betterAuthUrl, dashboardSubdomain, dashboardBaseDomain, baseDomainConfigs),
    mcpEnabled: (process.env.MCP_ENABLED ?? 'true').trim().toLowerCase() !== 'false',
    gitlabInstances: parseGitLabInstances(process.env.GITLAB_INSTANCES || ''),
  };
}

/** The orchestrator image reference used for update checks and self-replace.
 * WORKER_IMAGE_PREFIX is prepended as usual, unless ORCHESTRATOR_IMAGE already
 * names a registry (its first path segment is a host: contains `.` or `:`, or
 * is `localhost`, per Docker's reference grammar). That lets a self-built
 * orchestrator live in another registry than the worker image, without the
 * update button swapping it back to the prefixed upstream image. */
export function orchestratorImageRef(config: Pick<Config, 'workerImagePrefix' | 'orchestratorImage'>): string {
  const image = config.orchestratorImage;
  const first = image.split('/')[0] ?? '';
  const hasRegistry = image.includes('/') && (first.includes('.') || first.includes(':') || first === 'localhost');
  return hasRegistry ? image : (config.workerImagePrefix || '') + image;
}
