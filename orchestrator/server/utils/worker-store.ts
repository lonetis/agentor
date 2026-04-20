import { UserScopedJsonStore } from './user-scoped-store';
import type { RepoConfig, MountConfig, NetworkMode, ExposeApis } from '../../shared/types';

export interface WorkerRecord {
  id: string;
  /** Globally unique Docker container name — `<prefix>-<userId>-<name>`. */
  containerName: string;
  /** Per-user worker name. Two users may both have a worker named 'alpha' — the
   * combination of `userId + name` is unique, and `containerName` is derived
   * from both at creation time. */
  name: string;
  displayName?: string;
  environmentId?: string;
  environmentName?: string;
  createdAt: string;
  repos?: RepoConfig[];
  mounts?: MountConfig[];
  initScript?: string;
  cpuLimit?: number;
  memoryLimit?: string;
  networkMode?: NetworkMode;
  dockerEnabled?: boolean;
  allowedDomains?: string[];
  includePackageManagerDomains?: boolean;
  setupScript?: string;
  envVars?: string;
  exposeApis?: ExposeApis;
  capabilityNames?: string[];
  instructionNames?: string[];
  image: string;
  imageId: string;
  status: 'active' | 'archived';
  archivedAt?: string;
  userId: string;
  gitName?: string;
  gitEmail?: string;
}

export class WorkerStore extends UserScopedJsonStore<string, WorkerRecord> {
  constructor(dataDir: string) {
    super(dataDir, 'workers.json', (w) => w.name);
  }

  /** Flat list of every worker across every user, sorted by containerName
   * (stable global ordering). */
  override list(): WorkerRecord[] {
    return super.list().sort((a, b) => a.containerName.localeCompare(b.containerName));
  }

  override listForUser(userId: string): WorkerRecord[] {
    return super.listForUser(userId).sort((a, b) => a.name.localeCompare(b.name));
  }

  listArchived(): WorkerRecord[] {
    return this.list().filter((w) => w.status === 'archived');
  }

  listActive(): WorkerRecord[] {
    return this.list().filter((w) => w.status === 'active');
  }

  /** Find a worker by its globally unique Docker container name. Used when the
   * caller only knows the container name (e.g. reconciling from `docker inspect`
   * output or worker-facing API shortcuts). */
  findByContainerName(containerName: string): WorkerRecord | undefined {
    return this.findWithOwner((w) => w.containerName === containerName)?.item;
  }

  async upsert(worker: WorkerRecord): Promise<void> {
    const isNew = !this.has(worker.userId, worker.name);
    await this.setItem(worker.userId, worker);
    if (isNew) {
      useLogger().info(`[worker-store] registered worker ${worker.containerName} (status=${worker.status})`);
    } else {
      useLogger().debug(`[worker-store] updated worker ${worker.containerName}`);
    }
  }

  async archive(userId: string, name: string): Promise<void> {
    const worker = this.get(userId, name);
    if (!worker) {
      useLogger().warn(`[worker-store] archive failed — worker not found: ${userId}/${name}`);
      throw new Error(`Worker not found: ${name}`);
    }
    worker.status = 'archived';
    worker.archivedAt = new Date().toISOString();
    worker.id = '';
    await this.setItem(userId, worker);
    useLogger().info(`[worker-store] archived worker ${worker.containerName}`);
  }

  async unarchive(userId: string, name: string, newContainerId: string): Promise<void> {
    const worker = this.get(userId, name);
    if (!worker) {
      useLogger().warn(`[worker-store] unarchive failed — worker not found: ${userId}/${name}`);
      throw new Error(`Worker not found: ${name}`);
    }
    worker.status = 'active';
    worker.id = newContainerId;
    worker.archivedAt = undefined;
    await this.setItem(userId, worker);
    useLogger().info(`[worker-store] unarchived worker ${worker.containerName} (new container=${newContainerId.slice(0, 12)})`);
  }

  async delete(userId: string, name: string): Promise<void> {
    const existed = await this.deleteItem(userId, name);
    if (!existed) {
      useLogger().warn(`[worker-store] delete failed — worker not found: ${userId}/${name}`);
      throw new Error(`Worker not found: ${name}`);
    }
    useLogger().info(`[worker-store] deleted worker ${userId}/${name}`);
  }
}
