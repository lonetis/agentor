import { JsonStore } from './json-store';

export interface PortMapping {
  externalPort: number;
  type: 'localhost' | 'external';
  workerId: string;
  workerName: string;
  internalPort: number;
  appType?: string;
  instanceId?: string;
}

export class PortMappingStore extends JsonStore<number, PortMapping> {
  constructor(dataDir: string) {
    super(dataDir, 'port-mappings.json', (m) => m.externalPort);
  }

  async add(mapping: PortMapping): Promise<void> {
    if (this.has(mapping.externalPort)) {
      throw new Error(`Port ${mapping.externalPort} is already mapped`);
    }
    this.items.set(mapping.externalPort, mapping);
    await this.persist();
  }

  async remove(externalPort: number): Promise<boolean> {
    const existed = this.items.delete(externalPort);
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
