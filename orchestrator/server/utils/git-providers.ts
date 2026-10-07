import type { GitProviderType, RepoConfig } from '../../shared/types';
import type { GitLabInstanceConfig } from './config';
import { useConfig } from './services';

export interface GitProvider {
  id: string;
  type: GitProviderType;
  displayName: string;
  /** Web base URL without a trailing slash. Clone URLs, the API base and the
   * worker's per-host git credentials all derive from it. */
  url: string;
  placeholder: string;
  /** The env var NAME that holds this provider's token (looked up in the user's
   * env vars). */
  tokenEnvVar: string;
  /** Hosts the worker firewall allows in restricted network modes so cloning works. */
  cloneDomains: string[];
  /** Container registry the worker's Docker-in-Docker daemon logs into with the
   * provider token. */
  containerRegistry?: string;
}

/** The provider entry baked into the worker's `WORKER` env JSON — everything
 * the entrypoint needs to resolve repo paths and set up per-host auth. */
export interface WorkerGitProvider {
  id: string;
  type: GitProviderType;
  url: string;
  tokenEnvVar: string;
  containerRegistry?: string;
}

const GITHUB: GitProvider = {
  id: 'github',
  type: 'github',
  displayName: 'GitHub',
  url: 'https://github.com',
  placeholder: 'https://github.com/owner/repo',
  tokenEnvVar: 'GITHUB_TOKEN',
  cloneDomains: ['github.com', '*.github.com', '*.githubusercontent.com'],
  containerRegistry: 'ghcr.io',
};

const GITLAB_COM: GitProvider = {
  id: 'gitlab',
  type: 'gitlab',
  displayName: 'GitLab',
  url: 'https://gitlab.com',
  placeholder: 'https://gitlab.com/group/project',
  tokenEnvVar: 'GITLAB_TOKEN',
  cloneDomains: ['gitlab.com', '*.gitlab.com'],
  containerRegistry: 'registry.gitlab.com',
};

/** A self-managed GitLab server. Its container registry is not derivable from
 * the web URL (it may live on another host or port), so DinD does not log in. */
function gitlabInstanceProvider(instance: GitLabInstanceConfig): GitProvider {
  return {
    id: `gitlab-${instance.name}`,
    type: 'gitlab',
    displayName: `GitLab (${instance.name})`,
    url: instance.url,
    placeholder: `${instance.url}/group/project`,
    tokenEnvVar: `GITLAB_${instance.name.toUpperCase().replace(/-/g, '_')}_TOKEN`,
    cloneDomains: [new URL(instance.url).hostname],
  };
}

let providers: GitProvider[] | null = null;

/** All git providers: GitHub, gitlab.com, then the configured GitLab instances. */
export function listGitProviders(): GitProvider[] {
  providers ??= [GITHUB, GITLAB_COM, ...useConfig().gitlabInstances.map(gitlabInstanceProvider)];
  return providers;
}

export function getGitProvider(id: string): GitProvider | undefined {
  return listGitProviders().find((p) => p.id === id);
}

export function listWorkerGitProviders(): WorkerGitProvider[] {
  return listGitProviders().map(({ id, type, url, tokenEnvVar, containerRegistry }) => ({
    id, type, url, tokenEnvVar, ...(containerRegistry ? { containerRegistry } : {}),
  }));
}

export function getAllGitCloneDomains(): string[] {
  const domains = new Set<string>();
  for (const provider of listGitProviders()) {
    for (const d of provider.cloneDomains) {
      domains.add(d);
    }
  }
  return [...domains];
}

/** Validates and normalizes a `repos` request field. Returns the repos, or an
 * error message for a 400. A missing provider defaults to GitHub. */
export function parseRepoConfigs(input: unknown): { repos: RepoConfig[] } | { error: string } {
  if (!Array.isArray(input)) return { error: 'repos must be an array' };
  const repos: RepoConfig[] = [];
  for (const r of input) {
    if (typeof r !== 'object' || r === null) return { error: 'each repo must be an object' };
    const repo = r as Record<string, unknown>;
    if (repo.url !== undefined && typeof repo.url !== 'string') return { error: 'repo.url must be a string' };
    if (repo.provider !== undefined && typeof repo.provider !== 'string') return { error: 'repo.provider must be a string' };
    if (repo.branch !== undefined && typeof repo.branch !== 'string') return { error: 'repo.branch must be a string' };
    const provider = (repo.provider as string) || GITHUB.id;
    if (!getGitProvider(provider)) {
      return { error: `Unknown git provider "${provider}" (available: ${listGitProviders().map((p) => p.id).join(', ')})` };
    }
    repos.push({
      provider,
      url: (repo.url as string) || '',
      ...(repo.branch ? { branch: repo.branch as string } : {}),
    });
  }
  return { repos };
}
