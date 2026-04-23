defineRouteMeta({
  openAPI: {
    tags: ['Config'],
    summary: 'Get all system settings',
    description: 'Returns all system configuration organized by category. Values are read-only (set via environment variables). Sensitive values are masked.',
    operationId: 'getSettings',
    responses: {
      200: {
        description: 'Array of setting sections, each containing categorized setting items',
        content: { 'application/json': { schema: { type: 'array', description: 'Setting sections with id, label, and items[]' } } },
      },
    },
  },
});

import { useConfig, useInitScriptStore } from '../utils/services';
import { listGitProviders } from '../utils/git-providers';
import { listAppTypes } from '../utils/apps';
import { requireAdmin } from '../utils/auth-helpers';

interface SettingItem {
  key: string;
  label: string;
  value: string | number | boolean | string[] | null;
  type: 'string' | 'number' | 'boolean' | 'list' | 'status';
  sensitive?: boolean;
}

interface SettingSection {
  id: string;
  label: string;
  items: SettingItem[];
}

function statusValue(configured: boolean): string {
  return configured ? 'configured' : 'not configured';
}

export default defineEventHandler(async (event) => {
  requireAdmin(event);
  const config = useConfig();
  const sections: SettingSection[] = [];

  // --- Docker & Infrastructure ---
  sections.push({
    id: 'docker',
    label: 'Docker & Infrastructure',
    items: [
      { key: 'DOCKER_NETWORK', label: 'Docker Network', value: config.dockerNetwork, type: 'string' },
      { key: 'CONTAINER_PREFIX', label: 'Container Prefix', value: config.containerPrefix, type: 'string' },
      { key: 'WORKER_IMAGE', label: 'Worker Image', value: config.workerImage, type: 'string' },
      { key: 'ORCHESTRATOR_IMAGE', label: 'Orchestrator Image', value: config.orchestratorImage, type: 'string' },
      { key: 'DATA_VOLUME', label: 'Data Volume', value: config.dataVolume, type: 'string' },
      { key: 'DATA_DIR', label: 'Data Directory', value: config.dataDir, type: 'string' },
      ...(config.workerImagePrefix
        ? [{ key: 'WORKER_IMAGE_PREFIX', label: 'Image Prefix (GHCR)', value: config.workerImagePrefix, type: 'string' as const }]
        : []),
    ],
  });

  // --- Worker Defaults ---
  sections.push({
    id: 'worker-defaults',
    label: 'Worker Defaults',
    items: [
      { key: 'DEFAULT_CPU_LIMIT', label: 'Default CPU Limit', value: config.defaultCpuLimit || 'unlimited', type: config.defaultCpuLimit ? 'number' : 'string' },
      { key: 'DEFAULT_MEMORY_LIMIT', label: 'Default Memory Limit', value: config.defaultMemoryLimit || 'unlimited', type: 'string' },
    ],
  });

  // --- Git Providers (domains only; tokens are per-user, see Account modal) ---
  const gitItems: SettingItem[] = [];
  for (const provider of listGitProviders()) {
    gitItems.push({
      key: `${provider.id}.cloneDomains`,
      label: `${provider.displayName} Clone Domains`,
      value: provider.cloneDomains,
      type: 'list',
    });
  }
  sections.push({
    id: 'git-providers',
    label: 'Git Providers',
    items: gitItems,
  });

  // --- Domain Mapping (Traefik) ---
  if (config.baseDomains.length > 0) {
    const domainItems: SettingItem[] = [
      { key: 'BASE_DOMAINS', label: 'Base Domains', value: config.baseDomains, type: 'list' },
      { key: 'TRAEFIK_IMAGE', label: 'Traefik Image', value: config.traefikImage, type: 'string' },
      { key: 'ACME_EMAIL', label: 'ACME Email', value: config.acmeEmail || 'not set', type: 'string' },
    ];

    // TLS challenge configs
    for (const domainConfig of config.baseDomainConfigs) {
      const label = domainConfig.challengeType === 'dns'
        ? `DNS-01 (${domainConfig.dnsProvider})`
        : domainConfig.challengeType === 'http'
          ? 'HTTP-01'
          : domainConfig.challengeType === 'selfsigned'
            ? 'Self-Signed CA'
            : 'None';
      domainItems.push({
        key: `tls.${domainConfig.domain}`,
        label: `${domainConfig.domain} TLS Challenge`,
        value: label,
        type: 'string',
      });
    }

    // Dashboard
    if (config.dashboardSubdomain) {
      domainItems.push({
        key: 'DASHBOARD_SUBDOMAIN',
        label: 'Dashboard Subdomain',
        value: config.dashboardSubdomain,
        type: 'string',
      });
      domainItems.push({
        key: 'DASHBOARD_BASE_DOMAIN',
        label: 'Dashboard Base Domain',
        value: config.dashboardBaseDomain,
        type: 'string',
      });
      domainItems.push({
        key: 'DASHBOARD_AUTH',
        label: 'Dashboard Auth',
        value: statusValue(!!config.dashboardAuthUser && !!config.dashboardAuthPassword),
        type: 'status',
      });
    }

    // DNS provider configs
    for (const [provider, dnsConfig] of Object.entries(config.dnsProviderConfigs)) {
      domainItems.push({
        key: `dns.${provider}.vars`,
        label: `${provider} DNS Env Vars`,
        value: dnsConfig.envVarNames,
        type: 'list',
      });
      if (dnsConfig.delay) {
        domainItems.push({
          key: `dns.${provider}.delay`,
          label: `${provider} DNS Delay`,
          value: `${dnsConfig.delay}s`,
          type: 'string',
        });
      }
      if (dnsConfig.resolvers.length > 0) {
        domainItems.push({
          key: `dns.${provider}.resolvers`,
          label: `${provider} DNS Resolvers`,
          value: dnsConfig.resolvers,
          type: 'list',
        });
      }
    }

    sections.push({
      id: 'domain-mapping',
      label: 'Domain Mapping (Traefik)',
      items: domainItems,
    });
  }

  // --- Network ---
  sections.push({
    id: 'network',
    label: 'Network',
    items: [
      {
        key: 'PACKAGE_MANAGER_DOMAINS',
        label: 'Custom Package Manager Domains',
        value: config.packageManagerDomains.length > 0 ? config.packageManagerDomains : 'using built-in defaults',
        type: config.packageManagerDomains.length > 0 ? 'list' : 'string',
      },
    ],
  });

  // --- Logging ---
  const logMaxSizeMb = Math.round((config.logMaxSize / (1024 * 1024)) * 10) / 10;
  sections.push({
    id: 'logging',
    label: 'Logging',
    items: [
      { key: 'LOG_LEVEL', label: 'Log Level', value: config.logLevel, type: 'string' },
      { key: 'LOG_MAX_SIZE', label: 'Max Log File Size', value: `${logMaxSizeMb}m`, type: 'string' },
      { key: 'LOG_MAX_FILES', label: 'Rotated Files per Category', value: config.logMaxFiles, type: 'number' },
    ],
  });

  // --- Authentication (better-auth) ---
  sections.push({
    id: 'authentication',
    label: 'Authentication',
    items: [
      {
        key: 'BETTER_AUTH_SECRET',
        label: 'Session Secret',
        value: statusValue(!!config.betterAuthSecret),
        type: 'status',
        sensitive: true,
      },
      {
        key: 'BETTER_AUTH_URL',
        label: 'Base URL',
        value: config.betterAuthUrl || 'http://localhost:3000 (default)',
        type: 'string',
      },
      {
        key: 'BETTER_AUTH_TRUSTED_ORIGINS',
        label: 'Extra Trusted Origins',
        value: config.betterAuthTrustedOrigins.length > 0
          ? config.betterAuthTrustedOrigins
          : 'none (auto-detected origins only)',
        type: config.betterAuthTrustedOrigins.length > 0 ? 'list' : 'string',
      },
      {
        key: 'BETTER_AUTH_RP_ID',
        label: 'Passkey Relying Party ID',
        value: config.betterAuthRpId || (config.dashboardSubdomain && config.dashboardBaseDomain
          ? `${config.dashboardSubdomain}.${config.dashboardBaseDomain} (auto)`
          : 'passkeys disabled (no dashboard domain)'),
        type: 'string',
      },
    ],
  });

  // --- Init Scripts ---
  const scriptItems: SettingItem[] = [];
  for (const script of useInitScriptStore().list()) {
    scriptItems.push({
      key: `init-script.${script.id}`,
      label: `${script.name}${script.builtIn ? '' : ' (custom)'}`,
      value: script.content.replace('#!/bin/bash\n', ''),
      type: 'string',
    });
  }
  sections.push({
    id: 'init-scripts',
    label: 'Init Scripts',
    items: scriptItems,
  });

  // --- App Types ---
  const appItems: SettingItem[] = [];
  for (const app of listAppTypes()) {
    appItems.push({
      key: `app.${app.id}`,
      label: app.displayName,
      value: app.description,
      type: 'string',
    });
    appItems.push({
      key: `app.${app.id}.ports`,
      label: `${app.displayName} Port Range`,
      value: app.ports.map((p) => `${p.name}: ${p.internalPortStart}-${p.internalPortEnd}`),
      type: 'list',
    });
    appItems.push({
      key: `app.${app.id}.maxInstances`,
      label: `${app.displayName} Max Instances`,
      value: app.maxInstances,
      type: 'number',
    });
  }
  sections.push({
    id: 'app-types',
    label: 'App Types',
    items: appItems,
  });

  return sections;
});
