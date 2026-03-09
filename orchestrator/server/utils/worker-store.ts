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
  skillNames?: string[];
  agentsMdNames?: string[];
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
    this.items.set(worker.name, worker);
    await this.persist();
  }

  async archive(name: string): Promise<void> {
    const worker = this.items.get(name);
    if (!worker) throw new Error(`Worker not found: ${name}`);
    worker.status = 'archived';
    worker.archivedAt = new Date().toISOString();
    worker.id = '';
    await this.persist();
  }

  async unarchive(name: string, newContainerId: string): Promise<void> {
    const worker = this.items.get(name);
    if (!worker) throw new Error(`Worker not found: ${name}`);
    worker.status = 'active';
    worker.id = newContainerId;
    worker.archivedAt = undefined;
    await this.persist();
  }

  async delete(name: string): Promise<void> {
    if (!this.items.has(name)) {
      throw new Error(`Worker not found: ${name}`);
    }
    this.items.delete(name);
    await this.persist();
  }
}
