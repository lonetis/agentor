import { randomUUID } from 'node:crypto';
import { UserScopedJsonStore } from './user-scoped-store';
import type { UserOwnedResource } from '../../shared/types';

export interface DomainMapping extends UserOwnedResource {
  subdomain: string;
  baseDomain: string;
  path: string;
  protocol: 'http' | 'https' | 'tcp';
  /**
   * When true, the router also matches any single-label prefix of the host
   * (e.g. `*.sub.domain.com` alongside `sub.domain.com`). Only valid when the
   * base domain's challenge type is `none`, `dns`, or `selfsigned` — HTTP-01
   * ACME cannot issue wildcard certificates.
   */
  wildcard: boolean;
  /** The owning worker's UUID `id` (used as a display fallback). */
  workerId: string;
  /** Globally unique Docker container name — used as the Traefik backend
   * address and as the stable identifier across rebuild/unarchive. */
  containerName: string;
  internalPort: number;
  basicAuth?: {
    username: string;
    password: string;
  };
}

/** Fields a caller supplies when creating a mapping. `id`/`createdAt`/`updatedAt`
 * are minted by the store. */
export type DomainMappingInput = Omit<DomainMapping, 'id' | 'createdAt' | 'updatedAt'>;

/** Per-user store of Traefik domain mappings
 * (`<DATA_DIR>/users/<userId>/domain-mappings.json`, keyed by UUID `id`). Removal
 * of a non-existent mapping is intentionally idempotent (logs at `debug`, returns
 * `false`) to support the worker-self DELETE-is-idempotent contract — unlike
 * `WorkerStore`, which throws on a missing worker. */
export class DomainMappingStore extends UserScopedJsonStore<string, DomainMapping> {
  constructor(dataDir: string) {
    super(dataDir, 'domain-mappings.json', (m) => m.id);
  }

  /** Returns the (userId, mapping) pair that owns `id`, or undefined. */
  findById(id: string): { userId: string; item: DomainMapping } | undefined {
    return this.findWithOwner((m) => m.id === id);
  }

  /** Create a mapping, minting its UUID `id` and timestamps. Runs uniqueness /
   * protocol-conflict checks. Returns the created mapping.
   *
   * Domain routes are a GLOBAL namespace (a hostname can only route to one
   * backend on the single shared Traefik), so the uniqueness check spans every
   * user. The error messages are deliberately generic — they confirm the route
   * the caller supplied is taken, but do not reveal whose mapping owns it. */
  async add(input: DomainMappingInput): Promise<DomainMapping> {
    const fullDomain = input.subdomain ? `${input.subdomain}.${input.baseDomain}` : input.baseDomain;
    const fullRoute = input.path ? `${fullDomain}${input.path}` : fullDomain;

    for (const existing of this.list()) {
      if (existing.subdomain !== input.subdomain || existing.baseDomain !== input.baseDomain) continue;

      // HTTPS and TCP both use Traefik's websecure entrypoint (port 443) —
      // TCP's HostSNI matches at the TLS layer before HTTP routing, so they conflict
      // regardless of path (TCP has no path awareness).
      const pair = new Set([existing.protocol, input.protocol]);
      if (pair.has('https') && pair.has('tcp')) {
        useLogger().warn(`[domain-mappings] HTTPS/TCP conflict for '${fullDomain}' rejected`);
        throw new Error(`'${fullDomain}' cannot have both HTTPS and TCP mappings (both use port 443)`);
      }

      // Same domain + path + protocol = duplicate
      if ((existing.path || '') === (input.path || '') && existing.protocol === input.protocol) {
        useLogger().warn(`[domain-mappings] duplicate ${input.protocol} mapping for '${fullRoute}' rejected`);
        throw new Error(`'${fullRoute}' is already in use for protocol '${input.protocol}'`);
      }
    }
    const now = new Date().toISOString();
    const mapping: DomainMapping = { id: randomUUID(), createdAt: now, updatedAt: now, ...input };
    await this.setItem(mapping.userId, mapping);
    useLogger().info(
      `[domain-mappings] added ${mapping.protocol} mapping ${fullRoute} → ${mapping.containerName}:${mapping.internalPort}${mapping.basicAuth ? ' (auth)' : ''}`,
    );
    return mapping;
  }

  async remove(id: string): Promise<boolean> {
    const owner = this.findById(id);
    if (!owner) {
      useLogger().debug(`[domain-mappings] remove called for non-existent id ${id}`);
      return false;
    }
    const mapping = owner.item;
    await this.deleteItem(owner.userId, id);
    const fullDomain = mapping.subdomain ? `${mapping.subdomain}.${mapping.baseDomain}` : mapping.baseDomain;
    useLogger().info(`[domain-mappings] removed ${mapping.protocol} mapping ${fullDomain} (${id})`);
    return true;
  }

  async removeForContainerName(containerName: string): Promise<number> {
    const count = await this.removeWhere((m) => m.containerName === containerName);
    if (count > 0) useLogger().info(`[domain-mappings] removed ${count} mapping(s) for container ${containerName}`);
    return count;
  }

  async cleanupStaleContainers(knownContainerNames: Set<string>): Promise<number> {
    const count = await this.removeWhere((m) => !knownContainerNames.has(m.containerName));
    if (count > 0) useLogger().warn(`[domain-mappings] cleaned up ${count} stale mapping(s)`);
    return count;
  }
}
