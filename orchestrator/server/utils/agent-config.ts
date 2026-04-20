interface AgentConfig {
  id: string;
  displayName: string;
  apiDomains: string[];
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
  },
  {
    id: 'vscode-tunnel',
    displayName: 'VS Code Tunnel',
    apiDomains: [
      '*.tunnels.api.visualstudio.com',
      '*.devtunnels.ms',
      'global.rel.tunnels.api.visualstudio.com',
      'login.microsoftonline.com',
      '*.vscode-cdn.net',
      'update.code.visualstudio.com',
      'vscode.download.prss.microsoft.com',
    ],
  },
];

export function getAllAgentApiDomains(): string[] {
  const domains = new Set<string>();
  for (const agent of AGENT_CONFIGS) {
    for (const d of agent.apiDomains) domains.add(d);
  }
  return [...domains];
}
