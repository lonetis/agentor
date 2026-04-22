import { UserScopedJsonStore } from './user-scoped-store';

export interface DomainMapping {
  id: string;
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
  /** Per-user worker name — shown in the UI. */
  workerName: string;
  /** Globally unique Docker container name — used as the Traefik backend
   * address and as the stable identifier across rebuild/unarchive. */
  containerName: string;
  internalPort: number;
  basicAuth?: {
    username: string;
    password: string;
  };
  userId: string;
}

export class DomainMappingStore extends UserScopedJsonStore<string, DomainMapping> {
  constructor(dataDir: string) {
    super(dataDir, 'domain-mappings.json', (m) => m.id);
  }

  /** Returns the (userId, mapping) pair that owns `id`, or undefined. Mapping
   * ids are nanoid-generated so globally unique. */
  findById(id: string): { userId: string; item: DomainMapping } | undefined {
    return this.findWithOwner((m) => m.id === id);
  }

  async add(mapping: DomainMapping): Promise<void> {
    const fullDomain = mapping.subdomain ? `${mapping.subdomain}.${mapping.baseDomain}` : mapping.baseDomain;
    const fullRoute = mapping.path ? `${fullDomain}${mapping.path}` : fullDomain;

    for (const existing of this.list()) {
      if (existing.subdomain !== mapping.subdomain || existing.baseDomain !== mapping.baseDomain) continue;

      // HTTPS and TCP both use Traefik's websecure entrypoint (port 443) —
      // TCP's HostSNI matches at the TLS layer before HTTP routing, so they conflict
      // regardless of path (TCP has no path awareness).
      const pair = new Set([existing.protocol, mapping.protocol]);
      if (pair.has('https') && pair.has('tcp')) {
        useLogger().warn(`[domain-mappings] HTTPS/TCP conflict for '${fullDomain}' rejected`);
        throw new Error(`'${fullDomain}' cannot have both HTTPS and TCP mappings (both use port 443)`);
      }

      // Same domain + path + protocol = duplicate
      if ((existing.path || '') === (mapping.path || '') && existing.protocol === mapping.protocol) {
        useLogger().warn(`[domain-mappings] duplicate ${mapping.protocol} mapping for '${fullRoute}' rejected`);
        throw new Error(`'${fullRoute}' is already mapped for protocol '${mapping.protocol}'`);
      }
    }
    await this.setItem(mapping.userId, mapping);
    useLogger().info(
      `[domain-mappings] added ${mapping.protocol} mapping ${fullRoute} → ${mapping.containerName}:${mapping.internalPort}${mapping.basicAuth ? ' (auth)' : ''}`,
    );
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
