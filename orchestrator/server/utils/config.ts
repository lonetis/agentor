export interface Config {
  githubToken: string;
  anthropicApiKey: string;
  openaiApiKey: string;
  geminiApiKey: string;
  dockerNetwork: string;
  containerPrefix: string;
  defaultCpuLimit: number;
  defaultMemoryLimit: string;
  workerImage: string;
  mapperImage: string;
  dataVolume: string;
  orchestratorImage: string;
  workerImagePrefix: string;
  packageManagerDomains: string[];
  dataDir: string;
  baseDomains: string[];
  dashboardBaseDomain: string;
  dashboardSubdomain: string;
  acmeEmail: string;
  traefikImage: string;
  dashboardAuthUser: string;
  dashboardAuthPassword: string;
}

export function loadConfig(): Config {
  const pmDomainsEnv = process.env.PACKAGE_MANAGER_DOMAINS?.trim();

  const baseDomains = (process.env.BASE_DOMAINS || '')
    .split(',').map((d) => d.trim()).filter(Boolean);

  const dashboardBaseDomainEnv = process.env.DASHBOARD_BASE_DOMAIN?.trim() || '';
  const dashboardBaseDomain = dashboardBaseDomainEnv && baseDomains.includes(dashboardBaseDomainEnv)
    ? dashboardBaseDomainEnv
    : baseDomains[0] || '';

  return {
    githubToken: process.env.GITHUB_TOKEN || '',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    dockerNetwork: process.env.DOCKER_NETWORK || 'agentor-net',
    containerPrefix: process.env.CONTAINER_PREFIX || 'agentor-worker',
    defaultCpuLimit: parseFloat(process.env.DEFAULT_CPU_LIMIT || '0'),
    defaultMemoryLimit: process.env.DEFAULT_MEMORY_LIMIT || '',
    workerImage: process.env.WORKER_IMAGE || 'agentor-worker:latest',
    mapperImage: process.env.MAPPER_IMAGE || 'agentor-mapper:latest',
    dataVolume: process.env.DATA_VOLUME || './data',
    orchestratorImage: process.env.ORCHESTRATOR_IMAGE || 'agentor-orchestrator:latest',
    workerImagePrefix: process.env.WORKER_IMAGE_PREFIX || '',
    packageManagerDomains: pmDomainsEnv
      ? pmDomainsEnv.split(',').map((d) => d.trim()).filter(Boolean)
      : [],
    dataDir: process.env.DATA_DIR || '/data',
    baseDomains,
    dashboardBaseDomain,
    dashboardSubdomain: process.env.DASHBOARD_SUBDOMAIN || '',
    acmeEmail: process.env.ACME_EMAIL || '',
    traefikImage: process.env.TRAEFIK_IMAGE || 'traefik:v3',
    dashboardAuthUser: process.env.DASHBOARD_AUTH_USER || '',
    dashboardAuthPassword: process.env.DASHBOARD_AUTH_PASSWORD || '',
  };
}
