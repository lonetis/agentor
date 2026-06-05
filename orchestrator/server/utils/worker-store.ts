import { UserScopedJsonStore } from './user-scoped-store';
import type { RepoConfig, MountConfig, UserOwnedResource } from '../../shared/types';

/** Persisted worker metadata. `id` (from `UserOwnedResource`) is the worker's
 * stable UUID identity — the store key and the `agentor.id` Docker label. The
 * Docker container is described by `containerId` (changes on rebuild) and
 * `containerName` (`<prefix>-<id>`, stable). Extends `UserOwnedResource`, so it
 * also carries `userId`/`createdAt`/`updatedAt`. */
export interface WorkerRecord extends UserOwnedResource {
  /** Current Docker container ID (empty while archived). Changes on every
   * rebuild/unarchive — never the worker's identity. */
  containerId: string;
  /** Globally unique Docker container name — `<prefix>-<id>` (stable). */
  containerName: string;
  /** Editable, user-facing label. Free-form and not required to be unique. */
  displayName: string;
  imageName: string;
  imageId: string;
  status: 'active' | 'archived';
  archivedAt?: string;
  /** Foreign key to the assigned environment — the only environment data stored
   * on the worker. The environment's config (CPU/memory/network/docker/setup
   * script/env vars/exposed APIs/capabilities/instructions) lives in the
   * EnvironmentStore and is resolved live at build time. Git identity is resolved
   * live from `userId`. */
  environmentId?: string;
  repos?: RepoConfig[];
  mounts?: MountConfig[];
  initScript?: string;
  /** True when rebuild-requiring settings (environment, repos, mounts, init
   * script) were edited after the container was last (re)created and have not
   * yet been applied. Cleared on create/rebuild/unarchive. */
  pendingRebuild?: boolean;
}

export class WorkerStore extends UserScopedJsonStore<string, WorkerRecord> {
  constructor(dataDir: string) {
    super(dataDir, 'workers.json', (w) => w.id);
  }

  /** Flat list of every worker across every user, sorted by containerName
   * (stable global ordering). */
  override list(): WorkerRecord[] {
    return super.list().sort((a, b) => a.containerName.localeCompare(b.containerName));
  }

  override listForUser(userId: string): WorkerRecord[] {
    // Sort by the user-facing label (the UUID `id` is meaningless to sort on).
    return super.listForUser(userId).sort((a, b) =>
      (a.displayName || a.id).localeCompare(b.displayName || b.id),
    );
  }

  listArchived(): WorkerRecord[] {
    return this.list().filter((w) => w.status === 'archived');
  }

  listActive(): WorkerRecord[] {
    return this.list().filter((w) => w.status === 'active');
  }

  /** Find a worker by its UUID `id` across all users. Used when only the worker
   * id is known (e.g. resolving the `agentor.id` Docker label during reconcile). */
  findById(id: string): WorkerRecord | undefined {
    return this.findWithOwner((w) => w.id === id)?.item;
  }

  /** Find a worker by its globally unique Docker container name. Used when the
   * caller only knows the container name (e.g. worker-self API shortcuts or
   * mapping reassignment). */
  findByContainerName(containerName: string): WorkerRecord | undefined {
    return this.findWithOwner((w) => w.containerName === containerName)?.item;
  }

  async upsert(worker: WorkerRecord): Promise<void> {
    const isNew = !this.has(worker.userId, worker.id);
    await this.setItem(worker.userId, worker);
    if (isNew) {
      useLogger().info(`[worker-store] registered worker ${worker.containerName} (status=${worker.status})`);
    } else {
      useLogger().debug(`[worker-store] updated worker ${worker.containerName}`);
    }
  }

  async archive(userId: string, id: string): Promise<void> {
    const worker = this.get(userId, id);
    if (!worker) {
      useLogger().warn(`[worker-store] archive failed — worker not found: ${userId}/${id}`);
      throw new Error(`Worker not found: ${id}`);
    }
    worker.status = 'archived';
    worker.archivedAt = new Date().toISOString();
    worker.updatedAt = worker.archivedAt;
    worker.containerId = '';
    await this.setItem(userId, worker);
    useLogger().info(`[worker-store] archived worker ${worker.containerName}`);
  }

  async unarchive(userId: string, id: string, newContainerId: string): Promise<void> {
    const worker = this.get(userId, id);
    if (!worker) {
      useLogger().warn(`[worker-store] unarchive failed — worker not found: ${userId}/${id}`);
      throw new Error(`Worker not found: ${id}`);
    }
    worker.status = 'active';
    worker.containerId = newContainerId;
    worker.archivedAt = undefined;
    worker.updatedAt = new Date().toISOString();
    await this.setItem(userId, worker);
    useLogger().info(`[worker-store] unarchived worker ${worker.containerName} (new container=${newContainerId.slice(0, 12)})`);
  }

  async delete(userId: string, id: string): Promise<void> {
    const existed = await this.deleteItem(userId, id);
    if (!existed) {
      useLogger().warn(`[worker-store] delete failed — worker not found: ${userId}/${id}`);
      throw new Error(`Worker not found: ${id}`);
    }
    useLogger().info(`[worker-store] deleted worker ${userId}/${id}`);
  }
}
