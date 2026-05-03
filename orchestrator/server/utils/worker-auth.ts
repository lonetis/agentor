import type { H3Event } from 'h3';
import { createError } from 'h3';
import { useDockerService, useContainerManager, useConfig } from './services';
import type { ContainerInfo } from '../../shared/types';

export interface WorkerSelfContext {
  container: ContainerInfo;
  userId: string;
  containerName: string;
  workerName: string;
}

interface IpMapEntry {
  containerName: string;
}

let ipCache: Map<string, IpMapEntry> = new Map();
let cacheTime = 0;
const CACHE_TTL_MS = 3000;

function normalizeIp(ip: string | undefined): string | undefined {
  if (!ip) return undefined;
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  return ip;
}

async function refreshIpCache(): Promise<void> {
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
}

async function resolveCallerByIp(remoteIp: string): Promise<ContainerInfo | null> {
  const containerManager = useContainerManager();

  if (Date.now() - cacheTime > CACHE_TTL_MS || !ipCache.has(remoteIp)) {
    await refreshIpCache();
  }
  const entry = ipCache.get(remoteIp);
  if (!entry) return null;

  const container = containerManager.findByContainerName(entry.containerName);
  if (container) return container;

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
    workerName: container.name,
  };
}
