import { randomUUID } from 'node:crypto';
import { UserScopedJsonStore } from './user-scoped-store';
import type { UserOwnedResource } from '../../shared/types';

export interface PortMapping extends UserOwnedResource {
  externalPort: number;
  type: 'localhost' | 'external';
  /** The owning worker's UUID `id` (used as a display fallback). */
  workerId: string;
  /** Globally unique Docker container name — used as the Traefik backend
   * address and as the stable identifier across rebuild/unarchive (the
   * container name stays the same, only the container ID changes). */
  containerName: string;
  internalPort: number;
  appType?: string;
  instanceId?: string;
}

/** Fields a caller supplies when creating a mapping. `id`/`createdAt`/`updatedAt`
 * are minted by the store. */
export type PortMappingInput = Omit<PortMapping, 'id' | 'createdAt' | 'updatedAt'>;

export class PortMappingStore extends UserScopedJsonStore<string, PortMapping> {
  constructor(dataDir: string) {
    super(dataDir, 'port-mappings.json', (m) => m.id);
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

  /** Returns the (userId, mapping) pair with the given UUID `id`, or undefined. */
  findById(id: string): { userId: string; item: PortMapping } | undefined {
    return this.findWithOwner((m) => m.id === id);
  }

  /** Finds an existing mapping that belongs to a specific worker + app instance.
   * Used by auto-port-mapping apps (e.g. ssh) to reuse the same external port
   * across stop/start so the connection string stays stable. */
  findByWorkerAndAppType(
    containerName: string,
    appType: string,
    instanceId?: string,
  ): PortMapping | undefined {
    return this.list().find(
      (m) =>
        m.containerName === containerName &&
        m.appType === appType &&
        (instanceId === undefined || m.instanceId === instanceId),
    );
  }

  /** Returns the lowest unused external port in `[rangeStart, rangeEnd]`, or null. */
  findFreeExternalPort(rangeStart: number, rangeEnd: number): number | null {
    const used = new Set(this.list().map((m) => m.externalPort));
    for (let p = rangeStart; p <= rangeEnd; p++) {
      if (!used.has(p)) return p;
    }
    return null;
  }

  /** Create a mapping, minting its UUID `id` and timestamps. Rejects a duplicate
   * external port. Returns the created mapping. */
  async add(input: PortMappingInput): Promise<PortMapping> {
    const existing = this.findByPort(input.externalPort);
    if (existing) {
      useLogger().warn(`[port-mappings] duplicate port ${input.externalPort} rejected`);
      throw new Error(`Port ${input.externalPort} is already mapped`);
    }
    const now = new Date().toISOString();
    const mapping: PortMapping = { id: randomUUID(), createdAt: now, updatedAt: now, ...input };
    await this.setItem(mapping.userId, mapping);
    useLogger().info(
      `[port-mappings] added ${mapping.type} mapping :${mapping.externalPort} → ${mapping.containerName}:${mapping.internalPort}`,
    );
    return mapping;
  }

  async remove(externalPort: number): Promise<boolean> {
    const owner = this.findByPort(externalPort);
    if (!owner) {
      useLogger().debug(`[port-mappings] remove called for non-existent port ${externalPort}`);
      return false;
    }
    await this.deleteItem(owner.userId, owner.item.id);
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
