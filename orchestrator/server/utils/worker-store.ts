import { UserScopedJsonStore } from './user-scoped-store';
import type { RepoConfig, MountConfig, UserOwnedResource } from '../../shared/types';

/** Persisted worker metadata — intentionally minimal. It stores ONLY what cannot
 * be discovered from Docker at runtime: the worker's identity, owner, editable
 * label, lifecycle marker, and the config used to (re)build its container.
 *
 * `id` (from `UserOwnedResource`) is the worker's stable UUID identity — the store
 * key and the `agentor.id` Docker label. Everything describing the live container
 * (its Docker id, `<prefix>-<id>` name, image name + image id, running/stopped
 * state) is resolved at runtime in `ContainerManager.sync()` by matching the
 * `agentor.id` label, never persisted here. Extends `UserOwnedResource`, so it
 * also carries `userId`/`createdAt`/`updatedAt`. */
export interface WorkerRecord extends UserOwnedResource {
  /** Editable, user-facing label. Free-form and not required to be unique. */
  displayName: string;
  /** Lifecycle marker. `active` = a Docker container exists for this worker;
   * `archived` = the container was removed but the worker's volumes + config are
   * kept for unarchiving. (For archived workers the record is the only evidence
   * the worker exists, since no container remains to discover it from.) */
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

  /** Flat list of every worker across every user, sorted by the immutable UUID
   * `id` (stable global ordering — the old containerName sort was equivalent
   * since containerName is just `<prefix>-<id>`). */
  override list(): WorkerRecord[] {
    return super.list().sort((a, b) => a.id.localeCompare(b.id));
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

  /** Find a worker by its UUID `id` across all users. Used to resolve the
   * `agentor.id` Docker label back to its record (and, since `containerName` is
   * just `<prefix>-<id>`, to resolve a container name once the prefix is stripped). */
  findById(id: string): WorkerRecord | undefined {
    return this.findWithOwner((w) => w.id === id)?.item;
  }

  async upsert(worker: WorkerRecord): Promise<void> {
    const isNew = !this.has(worker.userId, worker.id);
    await this.setItem(worker.userId, worker);
    const label = worker.displayName || worker.id;
    if (isNew) {
      useLogger().info(`[worker-store] registered worker ${label} (status=${worker.status})`);
    } else {
      useLogger().debug(`[worker-store] updated worker ${label}`);
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
    await this.setItem(userId, worker);
    useLogger().info(`[worker-store] archived worker ${worker.displayName || worker.id}`);
  }

  async unarchive(userId: string, id: string): Promise<void> {
    const worker = this.get(userId, id);
    if (!worker) {
      useLogger().warn(`[worker-store] unarchive failed — worker not found: ${userId}/${id}`);
      throw new Error(`Worker not found: ${id}`);
    }
    worker.status = 'active';
    worker.archivedAt = undefined;
    worker.updatedAt = new Date().toISOString();
    await this.setItem(userId, worker);
    useLogger().info(`[worker-store] unarchived worker ${worker.displayName || worker.id}`);
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
