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

/** Per-user store of TCP port mappings (`<DATA_DIR>/users/<userId>/port-mappings.json`,
 * keyed by UUID `id`). Removal of a non-existent mapping is intentionally
 * idempotent (logs at `debug`, returns `false`) to support the worker-self
 * DELETE-is-idempotent contract — unlike `WorkerStore`, which throws on a
 * missing worker. */
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
   * across stop/start so the connection string stays stable.
   *
   * `containerName` is globally unique (`agentor-worker-<uuid>`), so the match is
   * already unambiguous; `expectedUserId`, when provided, is a defense-in-depth
   * guard that refuses to return a mapping owned by a different user. Iterates
   * the internal maps directly (no `list()` allocation/sort). */
  findByWorkerAndAppType(
    containerName: string,
    appType: string,
    instanceId?: string,
    expectedUserId?: string,
  ): PortMapping | undefined {
    const match = this.findWithOwner(
      (m) =>
        m.containerName === containerName &&
        m.appType === appType &&
        (instanceId === undefined || m.instanceId === instanceId),
    );
    if (!match) return undefined;
    if (expectedUserId !== undefined && match.item.userId !== expectedUserId) {
      useLogger().warn(
        `[port-mappings] refused cross-user reuse of ${appType} mapping on ${containerName} (owner ${match.userId} != ${expectedUserId})`,
      );
      return undefined;
    }
    return match.item;
  }

  /** Returns the lowest unused external port in `[rangeStart, rangeEnd]`, or
   * null. `exclude` is an optional set of additional ports to skip — used by
   * auto-allocating apps to retry past a candidate that turned out to be
   * occupied on the host (and so couldn't be bound by Traefik). */
  findFreeExternalPort(rangeStart: number, rangeEnd: number, exclude?: Set<number>): number | null {
    const used = new Set<number>();
    for (const map of this.items.values()) {
      for (const m of map.values()) used.add(m.externalPort);
    }
    for (let p = rangeStart; p <= rangeEnd; p++) {
      if (!used.has(p) && !exclude?.has(p)) return p;
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
