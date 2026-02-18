import type { Config } from './config';

export interface InitPreset {
  id: string;
  displayName: string;
  script: string;
  apiDomains: string[];
  envVars: Record<string, string>;
}

export const INIT_PRESETS: Record<string, InitPreset> = {
  claude: {
    id: 'claude',
    displayName: 'Claude',
    script: '#!/bin/bash\nclaude --dangerously-skip-permissions',
    apiDomains: [
      'api.anthropic.com',
      'claude.ai',
      'console.anthropic.com',
      'statsig.anthropic.com',
      'sentry.io',
      'storage.googleapis.com',
    ],
    envVars: {
      ANTHROPIC_API_KEY: 'anthropicApiKey',
    },
  },
  codex: {
    id: 'codex',
    displayName: 'Codex',
    script: '#!/bin/bash\ncodex --dangerously-bypass-approvals-and-sandbox',
    apiDomains: [
      'api.openai.com',
      'chatgpt.com',
      'chat.openai.com',
      'auth.openai.com',
      'ab.chatgpt.com',
      'sentry.io',
    ],
    envVars: {
      OPENAI_API_KEY: 'openaiApiKey',
    },
  },
  gemini: {
    id: 'gemini',
    displayName: 'Gemini',
    script: '#!/bin/bash\ngemini --yolo',
    apiDomains: [
      'generativelanguage.googleapis.com',
      'accounts.google.com',
      'oauth2.googleapis.com',
      'www.googleapis.com',
      'cloudcode-pa.googleapis.com',
      'registry.npmjs.org',
      'github.com',
    ],
    envVars: {
      GEMINI_API_KEY: 'geminiApiKey',
    },
  },
};

export function listInitPresets(): InitPreset[] {
  return Object.values(INIT_PRESETS);
}

export function getAllApiDomains(): string[] {
  const domains = new Set<string>();
  for (const preset of Object.values(INIT_PRESETS)) {
    for (const d of preset.apiDomains) {
      domains.add(d);
    }
  }
  return [...domains];
}

export function getAllAgentEnvVars(config: Config): string[] {
  const vars: string[] = [];
  const seen = new Set<string>();
  for (const preset of Object.values(INIT_PRESETS)) {
    for (const [envName, configKey] of Object.entries(preset.envVars)) {
      if (seen.has(envName)) continue;
      seen.add(envName);
      const value = config[configKey as keyof Config];
      if (value) {
        vars.push(`${envName}=${value}`);
      }
    }
  }
  return vars;
}
