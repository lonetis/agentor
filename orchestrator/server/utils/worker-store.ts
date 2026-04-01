import { JsonStore } from './json-store';
import type { RepoConfig, MountConfig, NetworkMode, ExposeApis } from '../../shared/types';

export interface WorkerRecord {
  id: string;
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
}

export class WorkerStore extends JsonStore<string, WorkerRecord> {
  constructor(dataDir: string) {
    super(dataDir, 'workers.json', (w) => w.name);
  }

  override list(): WorkerRecord[] {
    return super.list().sort((a, b) => a.name.localeCompare(b.name));
  }

  listArchived(): WorkerRecord[] {
    return this.list().filter((w) => w.status === 'archived');
  }

  listActive(): WorkerRecord[] {
    return this.list().filter((w) => w.status === 'active');
  }

  async upsert(worker: WorkerRecord): Promise<void> {
    const isNew = !this.items.has(worker.name);
    this.items.set(worker.name, worker);
    await this.persist();
    if (isNew) {
      useLogger().info(`[worker-store] registered worker ${worker.name} (status=${worker.status})`);
    } else {
      useLogger().debug(`[worker-store] updated worker ${worker.name}`);
    }
  }

  async archive(name: string): Promise<void> {
    const worker = this.items.get(name);
    if (!worker) {
      useLogger().warn(`[worker-store] archive failed — worker not found: ${name}`);
      throw new Error(`Worker not found: ${name}`);
    }
    worker.status = 'archived';
    worker.archivedAt = new Date().toISOString();
    worker.id = '';
    await this.persist();
    useLogger().info(`[worker-store] archived worker ${name}`);
  }

  async unarchive(name: string, newContainerId: string): Promise<void> {
    const worker = this.items.get(name);
    if (!worker) {
      useLogger().warn(`[worker-store] unarchive failed — worker not found: ${name}`);
      throw new Error(`Worker not found: ${name}`);
    }
    worker.status = 'active';
    worker.id = newContainerId;
    worker.archivedAt = undefined;
    await this.persist();
    useLogger().info(`[worker-store] unarchived worker ${name} (new container=${newContainerId.slice(0, 12)})`);
  }

  async delete(name: string): Promise<void> {
    if (!this.items.has(name)) {
      useLogger().warn(`[worker-store] delete failed — worker not found: ${name}`);
      throw new Error(`Worker not found: ${name}`);
    }
    this.items.delete(name);
    await this.persist();
    useLogger().info(`[worker-store] deleted worker ${name}`);
  }
}
