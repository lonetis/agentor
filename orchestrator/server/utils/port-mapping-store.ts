import { UserScopedJsonStore } from './user-scoped-store';

export interface PortMapping {
  externalPort: number;
  type: 'localhost' | 'external';
  /** Per-user worker name — shown in the UI ("happy-panda"). */
  workerName: string;
  /** Globally unique Docker container name — used as the Traefik backend
   * address and as the stable identifier across rebuild/unarchive (the
   * container name stays the same, only the container ID changes). */
  containerName: string;
  internalPort: number;
  appType?: string;
  instanceId?: string;
  userId: string;
}

export class PortMappingStore extends UserScopedJsonStore<number, PortMapping> {
  constructor(dataDir: string) {
    super(dataDir, 'port-mappings.json', (m) => m.externalPort);
  }

  override list(): PortMapping[] {
    return super.list().sort((a, b) => a.externalPort - b.externalPort);
  }

  /** Returns the (userId, mapping) pair that owns `externalPort`, or undefined.
   * External ports are globally unique (the host can only bind one per port),
   * so there is at most one owner. */
  findByPort(externalPort: number): { userId: string; item: PortMapping } | undefined {
    return this.findWithOwner((m) => m.externalPort === externalPort);
  }

  async add(mapping: PortMapping): Promise<void> {
    const existing = this.findByPort(mapping.externalPort);
    if (existing) {
      useLogger().warn(`[port-mappings] duplicate port ${mapping.externalPort} rejected`);
      throw new Error(`Port ${mapping.externalPort} is already mapped`);
    }
    await this.setItem(mapping.userId, mapping);
    useLogger().info(
      `[port-mappings] added ${mapping.type} mapping :${mapping.externalPort} → ${mapping.containerName}:${mapping.internalPort}`,
    );
  }

  async remove(externalPort: number): Promise<boolean> {
    const owner = this.findByPort(externalPort);
    if (!owner) {
      useLogger().debug(`[port-mappings] remove called for non-existent port ${externalPort}`);
      return false;
    }
    await this.deleteItem(owner.userId, externalPort);
    useLogger().info(`[port-mappings] removed mapping :${externalPort}`);
    return true;
  }

  async removeForContainerName(containerName: string): Promise<number> {
    const count = await this.removeWhere((m) => m.containerName === containerName);
    if (count > 0) useLogger().info(`[port-mappings] removed ${count} mapping(s) for container ${containerName}`);
    return count;
  }

  async cleanupStaleContainers(knownContainerNames: Set<string>): Promise<number> {
    const count = await this.removeWhere((m) => !knownContainerNames.has(m.containerName));
    if (count > 0) useLogger().warn(`[port-mappings] cleaned up ${count} stale mapping(s)`);
    return count;
  }
}
