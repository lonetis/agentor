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
      useLogger().warn(`[port-mappings] duplicate port ${mapping.externalPort} rejected`);
      throw new Error(`Port ${mapping.externalPort} is already mapped`);
    }
    this.items.set(mapping.externalPort, mapping);
    await this.persist();
    useLogger().info(`[port-mappings] added ${mapping.type} mapping :${mapping.externalPort} → ${mapping.workerName}:${mapping.internalPort}`);
  }

  async remove(externalPort: number): Promise<boolean> {
    const existed = this.items.delete(externalPort);
    if (existed) {
      await this.persist();
      useLogger().info(`[port-mappings] removed mapping :${externalPort}`);
    } else {
      useLogger().debug(`[port-mappings] remove called for non-existent port ${externalPort}`);
    }
    return existed;
  }

  async removeForWorker(workerId: string): Promise<number> {
    const count = await this.removeWhere((m) => m.workerId === workerId);
    if (count > 0) useLogger().info(`[port-mappings] removed ${count} mapping(s) for worker ${workerId}`);
    return count;
  }

  async cleanupStaleWorkers(activeWorkerIds: Set<string>): Promise<number> {
    const count = await this.removeWhere((m) => !activeWorkerIds.has(m.workerId));
    if (count > 0) useLogger().warn(`[port-mappings] cleaned up ${count} stale mapping(s)`);
    return count;
  }
}
