import { JsonStore } from './json-store';

export interface DomainMapping {
  id: string;
  subdomain: string;
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
      if (existing.subdomain === mapping.subdomain) {
        throw new Error(`Subdomain '${mapping.subdomain}' is already mapped`);
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
