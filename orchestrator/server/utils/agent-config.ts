import type { Config } from './config';

interface AgentConfig {
  id: string;
  displayName: string;
  apiDomains: string[];
  envVars: Record<string, string>; // env var name → config key
}

const AGENT_CONFIGS: AgentConfig[] = [
  {
    id: 'claude',
    displayName: 'Claude',
    apiDomains: [
      'api.anthropic.com',
      'claude.ai',
      'console.anthropic.com',
      'statsig.anthropic.com',
      'sentry.io',
      'storage.googleapis.com',
    ],
    envVars: { ANTHROPIC_API_KEY: 'anthropicApiKey' },
  },
  {
    id: 'codex',
    displayName: 'Codex',
    apiDomains: [
      'api.openai.com',
      'chatgpt.com',
      'chat.openai.com',
      'auth.openai.com',
      'ab.chatgpt.com',
      'sentry.io',
    ],
    envVars: { OPENAI_API_KEY: 'openaiApiKey' },
  },
  {
    id: 'gemini',
    displayName: 'Gemini',
    apiDomains: [
      'generativelanguage.googleapis.com',
      'accounts.google.com',
      'oauth2.googleapis.com',
      'www.googleapis.com',
      'cloudcode-pa.googleapis.com',
      'registry.npmjs.org',
      'github.com',
    ],
    envVars: { GEMINI_API_KEY: 'geminiApiKey' },
  },
];

export function listAgentConfigs(): AgentConfig[] {
  return AGENT_CONFIGS;
}

export function getAllAgentApiDomains(): string[] {
  const domains = new Set<string>();
  for (const agent of AGENT_CONFIGS) {
    for (const d of agent.apiDomains) domains.add(d);
  }
  return [...domains];
}

export function getAllAgentEnvVars(config: Config): string[] {
  const vars: string[] = [];
  const seen = new Set<string>();
  for (const agent of AGENT_CONFIGS) {
    for (const [envName, configKey] of Object.entries(agent.envVars)) {
      if (seen.has(envName)) continue;
      seen.add(envName);
      const value = config[configKey as keyof Config];
      if (value) vars.push(`${envName}=${value}`);
    }
  }
  return vars;
}
