import { JsonStore } from './json-store';

export interface DomainMapping {
  id: string;
  subdomain: string;
  baseDomain: string;
  path: string;
  protocol: 'http' | 'https' | 'tcp';
  workerId: string;
  workerName: string;
  internalPort: number;
  basicAuth?: {
    username: string;
    password: string;
  };
}

export class DomainMappingStore extends JsonStore<string, DomainMapping> {
  constructor(dataDir: string) {
    super(dataDir, 'domain-mappings.json', (m) => m.id);
  }

  async add(mapping: DomainMapping): Promise<void> {
    const fullDomain = mapping.subdomain ? `${mapping.subdomain}.${mapping.baseDomain}` : mapping.baseDomain;
    const fullRoute = mapping.path ? `${fullDomain}${mapping.path}` : fullDomain;

    for (const existing of this.items.values()) {
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
    this.items.set(mapping.id, mapping);
    await this.persist();
    useLogger().info(`[domain-mappings] added ${mapping.protocol} mapping ${fullRoute} → ${mapping.workerName}:${mapping.internalPort}${mapping.basicAuth ? ' (auth)' : ''}`);
  }

  async remove(id: string): Promise<boolean> {
    const mapping = this.items.get(id);
    const existed = this.items.delete(id);
    if (existed) {
      await this.persist();
      const fullDomain = mapping!.subdomain ? `${mapping!.subdomain}.${mapping!.baseDomain}` : mapping!.baseDomain;
      useLogger().info(`[domain-mappings] removed ${mapping!.protocol} mapping ${fullDomain} (${id})`);
    } else {
      useLogger().debug(`[domain-mappings] remove called for non-existent id ${id}`);
    }
    return existed;
  }

  async removeForWorkerName(workerName: string): Promise<number> {
    const count = await this.removeWhere((m) => m.workerName === workerName);
    if (count > 0) useLogger().info(`[domain-mappings] removed ${count} mapping(s) for worker ${workerName}`);
    return count;
  }

  async reassignWorkerContainer(workerName: string, newWorkerId: string): Promise<number> {
    let changed = 0;
    for (const mapping of this.items.values()) {
      if (mapping.workerName === workerName && mapping.workerId !== newWorkerId) {
        mapping.workerId = newWorkerId;
        changed++;
      }
    }
    if (changed > 0) {
      await this.persist();
      useLogger().info(`[domain-mappings] reassigned ${changed} mapping(s) for worker ${workerName} to new container`);
    }
    return changed;
  }

  async cleanupStaleWorkers(knownWorkerNames: Set<string>): Promise<number> {
    const count = await this.removeWhere((m) => !knownWorkerNames.has(m.workerName));
    if (count > 0) useLogger().warn(`[domain-mappings] cleaned up ${count} stale mapping(s)`);
    return count;
  }
}
