import type { H3Event } from 'h3';
import { getGitProvider, type GitProvider } from './git-providers';
import type { GitHostingService } from './git-hosting-client';
import { GitHubService } from './github';
import { GitLabService } from './gitlab';
import { requireAuth } from './auth-helpers';
import { useUserEnvStore } from './services';
import { getUserEnvVar } from './user-env-store';

export type { GitHostingService } from './git-hosting-client';

function createService(provider: GitProvider, token: string): GitHostingService {
  switch (provider.type) {
    case 'github': return new GitHubService(provider, token);
    case 'gitlab': return new GitLabService(provider, token);
  }
}

/** Evict cached instances idle longer than this so rotated tokens (and their
 * 60s caches) don't stay resident — and the plaintext token isn't retained as a
 * Map key for the whole process lifetime. */
const INSTANCE_IDLE_TTL_MS = 5 * 60_000;
/** Hard cap on distinct cached instances; the least-recently-used is evicted. */
const MAX_INSTANCES = 256;

interface InstanceEntry {
  service: GitHostingService;
  lastUsed: number;
}

const instances = new Map<string, InstanceEntry>();

/** Returns the hosting client for a provider bound to a user token, reusing
 * instances so their response caches persist across requests. */
export function getGitHostingService(provider: GitProvider, token: string): GitHostingService {
  const now = Date.now();
  for (const [key, entry] of instances) {
    if (now - entry.lastUsed > INSTANCE_IDLE_TTL_MS) instances.delete(key);
  }

  const key = `${provider.id}\0${token}`;
  let entry = instances.get(key);
  if (!entry) {
    entry = { service: createService(provider, token), lastUsed: now };
    instances.set(key, entry);
    if (instances.size > MAX_INSTANCES) {
      const sorted = [...instances.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
      for (let i = 0; i < sorted.length - MAX_INSTANCES; i++) {
        instances.delete(sorted[i]![0]);
      }
    }
  } else {
    entry.lastUsed = now;
  }
  return entry.service;
}

/** Resolves the `:providerId` route param (404 when unknown) and the calling
 * user's token for that provider (empty when unset). */
export function resolveGitProviderForUser(event: H3Event): { provider: GitProvider; token: string } {
  const { user } = requireAuth(event);
  const providerId = getRouterParam(event, 'providerId') || '';
  const provider = getGitProvider(providerId);
  if (!provider) throw createError({ statusCode: 404, statusMessage: `Unknown git provider: ${providerId}` });
  const token = getUserEnvVar(useUserEnvStore().getOrDefault(user.id), provider.tokenEnvVar);
  return { provider, token };
}

/** The calling user's hosting client for `:providerId`; 400 without a token. */
export function requireGitHostingService(event: H3Event): GitHostingService {
  const { provider, token } = resolveGitProviderForUser(event);
  if (!token) {
    throw createError({
      statusCode: 400,
      statusMessage: `${provider.displayName} token not configured — set ${provider.tokenEnvVar} in Account → environment variables`,
    });
  }
  return getGitHostingService(provider, token);
}
