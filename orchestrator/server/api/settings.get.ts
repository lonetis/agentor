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

import { useConfig, useCredentialMountManager, useInitScriptStore } from '../utils/services';
import { listGitProviders } from '../utils/git-providers';
import { listAppTypes } from '../utils/apps';
import { AGENT_CREDENTIAL_MAPPINGS } from '../utils/credential-mounts';
import { listAgentConfigs } from '../utils/agent-config';
import type { Config } from '../utils/config';

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

function mask(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '****';
  return value.slice(0, 4) + '****' + value.slice(-4);
}

function statusValue(configured: boolean): string {
  return configured ? 'configured' : 'not configured';
}

export default defineEventHandler(async () => {
  const config = useConfig();
  const credentialMountManager = useCredentialMountManager();
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
      { key: 'MAPPER_IMAGE', label: 'Mapper Image', value: config.mapperImage, type: 'string' },
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

  // --- Agent Authentication ---
  const authItems: SettingItem[] = [];

  // API keys
  const seen = new Set<string>();
  for (const agent of listAgentConfigs()) {
    for (const [envName, configKey] of Object.entries(agent.envVars)) {
      if (seen.has(envName)) continue;
      seen.add(envName);
      const value = config[configKey as keyof Config] as string;
      authItems.push({
        key: envName,
        label: `${agent.displayName} API Key`,
        value: statusValue(!!value),
        type: 'status',
        sensitive: true,
      });
    }
  }

  // OAuth credential files
  for (const mapping of AGENT_CREDENTIAL_MAPPINGS) {
    const configured = await credentialMountManager.getCredentialStatus(mapping.fileName);
    authItems.push({
      key: `.cred/${mapping.fileName}`,
      label: `${mapping.agentId.charAt(0).toUpperCase() + mapping.agentId.slice(1)} OAuth Credentials`,
      value: statusValue(configured),
      type: 'status',
    });
  }

  sections.push({
    id: 'agent-auth',
    label: 'Agent Authentication',
    items: authItems,
  });

  // --- Git Providers ---
  const gitItems: SettingItem[] = [];
  for (const provider of listGitProviders()) {
    const tokenValue = config[provider.tokenConfigKey as keyof Config] as string;
    gitItems.push({
      key: provider.tokenEnvVar,
      label: `${provider.displayName} Token`,
      value: statusValue(!!tokenValue),
      type: 'status',
      sensitive: true,
    });
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
