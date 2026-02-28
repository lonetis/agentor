import { JsonStore } from './json-store';

export interface DomainMapping {
  id: string;
  subdomain: string;
  baseDomain: string;
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
    for (const existing of this.items.values()) {
      if (existing.subdomain !== mapping.subdomain || existing.baseDomain !== mapping.baseDomain) continue;

      const fullDomain = `${mapping.subdomain}.${mapping.baseDomain}`;

      if (existing.protocol === mapping.protocol) {
        throw new Error(`'${fullDomain}' is already mapped for protocol '${mapping.protocol}'`);
      }

      // HTTPS and TCP both use Traefik's websecure entrypoint (port 443) —
      // TCP's HostSNI matches at the TLS layer before HTTP routing, so they conflict.
      const pair = new Set([existing.protocol, mapping.protocol]);
      if (pair.has('https') && pair.has('tcp')) {
        throw new Error(`'${fullDomain}' cannot have both HTTPS and TCP mappings (both use port 443)`);
      }
    }
    this.items.set(mapping.id, mapping);
    await this.persist();
  }

  async remove(id: string): Promise<boolean> {
    const existed = this.items.delete(id);
    if (existed) await this.persist();
    return existed;
  }

  removeForWorker(workerId: string): Promise<number> {
    return this.removeWhere((m) => m.workerId === workerId);
  }

  cleanupStaleWorkers(activeWorkerIds: Set<string>): Promise<number> {
    return this.removeWhere((m) => !activeWorkerIds.has(m.workerId));
  }
}
