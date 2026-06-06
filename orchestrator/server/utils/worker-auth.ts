import type { H3Event } from 'h3';
import { createError } from 'h3';
import { useDockerService, useContainerManager, useConfig } from './services';
import type { ContainerInfo } from '../../shared/types';

export interface WorkerSelfContext {
  container: ContainerInfo;
  userId: string;
  containerName: string;
  /** The calling worker's UUID `id`. */
  workerId: string;
}

interface IpMapEntry {
  containerName: string;
}

let ipCache: Map<string, IpMapEntry> = new Map();
let cacheTime = 0;
const CACHE_TTL_MS = 3000;

// A single shared in-flight refresh promise coalesces concurrent refreshes so
// that a burst of first-hit worker-self calls triggers exactly one Docker API
// round-trip instead of one per request (thundering herd).
let refreshInFlight: Promise<void> | null = null;

// Short negative cache: remember when we last refreshed because of an unknown
// source IP, so a stream of unknown-IP probes (a non-worker caller, or a worker
// whose container hasn't joined the cache yet) can't pin the orchestrator to a
// Docker-API call per request.
let lastUnknownRefresh = 0;
const UNKNOWN_REFRESH_TTL_MS = 1500;

function normalizeIp(ip: string | undefined): string | undefined {
  if (!ip) return undefined;
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  return ip;
}

async function refreshIpCache(): Promise<void> {
  // Coalesce concurrent refreshes onto one Docker call.
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const dockerService = useDockerService();
    const network = useConfig().dockerNetwork;
    const dockerContainers = await dockerService.listContainers();
    const next = new Map<string, IpMapEntry>();
    for (const c of dockerContainers) {
      const net = c.NetworkSettings?.Networks?.[network];
      if (!net?.IPAddress) continue;
      const containerName = c.Names[0]?.replace(/^\//, '');
      if (!containerName) continue;
      next.set(net.IPAddress, { containerName });
    }
    ipCache = next;
    cacheTime = Date.now();
  })();
  try {
    await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

async function resolveCallerByIp(remoteIp: string): Promise<ContainerInfo | null> {
  const containerManager = useContainerManager();

  const stale = Date.now() - cacheTime > CACHE_TTL_MS;
  const missing = !ipCache.has(remoteIp);
  // Only force a refresh for a missing IP if we haven't recently refreshed for
  // an unknown IP — otherwise an unknown-IP flood would refresh every request.
  const allowUnknownRefresh = Date.now() - lastUnknownRefresh > UNKNOWN_REFRESH_TTL_MS;
  if (stale || (missing && allowUnknownRefresh)) {
    if (missing && !stale) lastUnknownRefresh = Date.now();
    await refreshIpCache();
  }
  const entry = ipCache.get(remoteIp);
  if (!entry) return null;

  const container = containerManager.findByContainerName(entry.containerName);
  if (container) return container;

  // Cache hit for a name that no longer resolves to a running worker (e.g. the
  // container was rebuilt and got a new id under the same name) — force one
  // refresh and retry.
  await refreshIpCache();
  const retry = ipCache.get(remoteIp);
  if (!retry) return null;
  return containerManager.findByContainerName(retry.containerName) ?? null;
}

/**
 * Resolves the calling worker by its source IP on the Docker bridge network.
 * Worker containers join `agentor-net` and reach the orchestrator at
 * `http://agentor-orchestrator:3000` over the bridge — Docker assigns each
 * container a unique IP, so the source IP is sufficient identification.
 *
 * Routes mounted under `/api/worker-self/*` use this in place of session auth,
 * letting agents inside workers call the orchestrator without ever needing
 * a session cookie or API key.
 */
export async function requireWorkerSelf(event: H3Event): Promise<WorkerSelfContext> {
  const remoteIp = normalizeIp(event.node.req.socket?.remoteAddress ?? undefined);
  if (!remoteIp) {
    throw createError({ statusCode: 401, statusMessage: 'Unable to determine caller IP' });
  }

  const container = await resolveCallerByIp(remoteIp);
  if (!container) {
    throw createError({
      statusCode: 401,
      statusMessage: `No managed worker container found for caller IP ${remoteIp}. Worker-self endpoints can only be reached from inside a managed agentor worker on the Docker bridge network.`,
    });
  }

  if (container.status !== 'running') {
    throw createError({
      statusCode: 409,
      statusMessage: `Worker container is not in running state (status: ${container.status})`,
    });
  }

  return {
    container,
    userId: container.userId,
    containerName: container.containerName,
    workerId: container.id,
  };
}
