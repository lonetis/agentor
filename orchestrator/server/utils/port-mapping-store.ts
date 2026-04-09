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

  async removeForWorkerName(workerName: string): Promise<number> {
    const count = await this.removeWhere((m) => m.workerName === workerName);
    if (count > 0) useLogger().info(`[port-mappings] removed ${count} mapping(s) for worker ${workerName}`);
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
      useLogger().info(`[port-mappings] reassigned ${changed} mapping(s) for worker ${workerName} to new container`);
    }
    return changed;
  }

  async cleanupStaleWorkers(knownWorkerNames: Set<string>): Promise<number> {
    const count = await this.removeWhere((m) => !knownWorkerNames.has(m.workerName));
    if (count > 0) useLogger().warn(`[port-mappings] cleaned up ${count} stale mapping(s)`);
    return count;
  }
}
