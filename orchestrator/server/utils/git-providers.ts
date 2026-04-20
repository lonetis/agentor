import type { UserEnvVars } from '../../shared/types';

export interface GitProvider {
  id: string;
  displayName: string;
  placeholder: string;
  /** Field on UserEnvVars that holds this provider's token. */
  userEnvKey: keyof UserEnvVars;
  tokenEnvVar: string;
  cloneDomains: string[];
}

export const GIT_PROVIDER_REGISTRY: Record<string, GitProvider> = {
  github: {
    id: 'github',
    displayName: 'GitHub',
    placeholder: 'https://github.com/owner/repo',
    userEnvKey: 'githubToken',
    tokenEnvVar: 'GITHUB_TOKEN',
    cloneDomains: ['github.com', '*.github.com', '*.githubusercontent.com'],
  },
};

export function listGitProviders(): GitProvider[] {
  return Object.values(GIT_PROVIDER_REGISTRY);
}

export function getAllGitCloneDomains(): string[] {
  const domains = new Set<string>();
  for (const provider of Object.values(GIT_PROVIDER_REGISTRY)) {
    for (const d of provider.cloneDomains) {
      domains.add(d);
    }
  }
  return [...domains];
}
