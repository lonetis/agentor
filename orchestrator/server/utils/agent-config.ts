/** A source of outbound API domains that must stay reachable in restricted
 * network modes. This is purely a firewall-domain allowlist grouped by source —
 * only `apiDomains` is consumed (via `getAllAgentApiDomains`); `id` /
 * `displayName` are descriptive labels, not lookup keys. Env vars are NOT
 * configured here — they flow through the per-user uniform env-var list
 * (`renderUserEnvVars`). */
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
    // Matches the app registry id (`apps.ts` → `vscode`) so the same component
    // isn't referred to by two different identifiers across files.
    id: 'vscode',
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
