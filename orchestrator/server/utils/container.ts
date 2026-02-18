import { nanoid, customAlphabet } from 'nanoid';

const containerNanoid = customAlphabet('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 8);
import type { Config } from './config';
import { getAppType } from './apps';
import { DockerService } from './docker';
import type { AppInstanceInfo, RepoConfig, TmuxWindow } from '../../shared/types';
import { getAllApiDomains, getAllAgentEnvVars } from './init-presets';
import { getAllGitCloneDomains } from './git-providers';
import { getPackageManagerDomains } from './environments';
import type { EnvironmentStore } from './environments';
import type { WorkerStore, WorkerRecord } from './worker-store';
import type { CredentialMountManager } from './credential-mounts';
import type { NetworkMode, ServiceStatus, ContainerInfo, ContainerStatus, CreateContainerRequest } from '../../shared/types';

function parseLabelFloat(value: string | undefined): number | undefined {
  if (value == null) return undefined;
  const num = parseFloat(value);
  return Number.isNaN(num) ? undefined : num;
}

interface ResolvedEnvConfig {
  cpuLimit?: number;
  memoryLimit?: string;
  networkMode?: NetworkMode;
  allowedDomains?: string[];
  setupScriptB64?: string;
  initScriptB64?: string;
  customEnvVars?: string[];
  dockerEnabled?: boolean;
  environmentName?: string;
}

export class ContainerManager {
  private containers: Map<string, ContainerInfo> = new Map();
  private dockerService: DockerService;
  private config: Config;
  private environmentStore?: EnvironmentStore;
  private workerStore?: WorkerStore;
  private credentialMountManager?: CredentialMountManager;

  constructor(dockerService: DockerService, config: Config) {
    this.dockerService = dockerService;
    this.config = config;
  }

  setEnvironmentStore(store: EnvironmentStore): void {
    this.environmentStore = store;
  }

  setWorkerStore(store: WorkerStore): void {
    this.workerStore = store;
  }

  setCredentialMountManager(manager: CredentialMountManager): void {
    this.credentialMountManager = manager;
  }

  private resolveEnvironmentConfig(environmentId?: string): ResolvedEnvConfig {
    if (!environmentId || !this.environmentStore) return {};

    const env = this.environmentStore.get(environmentId);
    if (!env) throw new Error(`Environment not found: ${environmentId}`);

    let domains: string[] = [];
    if (env.networkMode === 'package-managers') {
      domains = [...getPackageManagerDomains()];
    } else if (env.networkMode === 'custom') {
      domains = [...env.allowedDomains];
      if (env.includePackageManagerDomains) {
        domains.push(...getPackageManagerDomains());
      }
    }

    if (env.networkMode !== 'full' && env.networkMode !== 'block-all') {
      domains.push(...getAllApiDomains());
      domains.push(...getAllGitCloneDomains());
    }

    const customEnvVars: string[] = [];
    if (env.envVars) {
      for (const line of env.envVars.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
          customEnvVars.push(trimmed);
        }
      }
    }

    return {
      cpuLimit: env.cpuLimit != null ? env.cpuLimit : undefined,
      memoryLimit: env.memoryLimit || undefined,
      networkMode: env.networkMode,
      allowedDomains: domains.length > 0 ? domains : undefined,
      setupScriptB64: env.setupScript ? Buffer.from(env.setupScript).toString('base64') : undefined,
      initScriptB64: env.initScript ? Buffer.from(env.initScript).toString('base64') : undefined,
      customEnvVars: customEnvVars.length > 0 ? customEnvVars : undefined,
      dockerEnabled: env.dockerEnabled ?? true,
      environmentName: env.name,
    };
  }

  private static readonly STATE_MAP: Record<string, ContainerStatus> = {
    running: 'running',
    exited: 'stopped',
    created: 'creating',
    dead: 'error',
    removing: 'removing',
  };

  async sync(): Promise<void> {
    const dockerContainers = await this.dockerService.listContainers();

    this.containers.clear();

    for (const dc of dockerContainers) {
      const labels = dc.Labels;

      let repos: RepoConfig[] | undefined;
      if (labels['agentor.repos']) {
        try {
          repos = JSON.parse(labels['agentor.repos']);
        } catch {
          repos = undefined;
        }
      }

      this.containers.set(dc.Id, {
        id: dc.Id,
        name: dc.Names[0]?.replace(/^\//, '') || dc.Id.slice(0, 12),
        displayName: labels['agentor.display-name'] || undefined,
        repos: repos?.length ? repos : undefined,
        status: ContainerManager.STATE_MAP[dc.State] || 'error',
        createdAt: labels['agentor.created'] || '',
        image: dc.Image,
        imageId: dc.ImageID,
        labels: Object.fromEntries(
          Object.entries(labels).filter(([k]) => k.startsWith('agentor.') && k !== 'agentor.managed')
        ),
      });
    }
  }

  list(): ContainerInfo[] {
    return Array.from(this.containers.values());
  }

  get(id: string): ContainerInfo | undefined {
    return this.containers.get(id);
  }

  generateName(): string {
    return `${this.config.containerPrefix}-${containerNanoid()}`;
  }

  async create(request: CreateContainerRequest): Promise<ContainerInfo> {
    const envConfig = this.resolveEnvironmentConfig(request.environmentId);

    // Init script priority: worker > environment
    let initScriptB64: string | undefined;
    const workerScript = request.initScript?.trim();
    const envScript = envConfig.initScriptB64; // already base64 if set

    if (workerScript) {
      initScriptB64 = Buffer.from(workerScript).toString('base64');
    } else if (envScript) {
      initScriptB64 = envScript;
    }

    const name = request.name || this.generateName();

    const repos = request.repos?.filter((r) => r.url) || [];

    const cpuLimit = envConfig.cpuLimit ?? request.cpuLimit ?? this.config.defaultCpuLimit ?? undefined;
    const memoryLimit = envConfig.memoryLimit || request.memoryLimit || this.config.defaultMemoryLimit || undefined;
    const dockerEnabled = envConfig.dockerEnabled ?? true;

    // Merge all agent env vars with environment custom env vars
    const allCustomEnvVars = [
      ...getAllAgentEnvVars(this.config),
      ...(envConfig.customEnvVars || []),
    ];

    const container = await this.dockerService.createWorkerContainer({
      name,
      displayName: request.displayName || undefined,
      repos: repos.length > 0 ? repos : undefined,
      cpuLimit,
      memoryLimit,
      mounts: request.mounts,
      networkMode: envConfig.networkMode,
      allowedDomains: envConfig.allowedDomains,
      setupScriptB64: envConfig.setupScriptB64,
      initScriptB64,
      customEnvVars: allCustomEnvVars.length > 0 ? allCustomEnvVars : undefined,
      dockerEnabled,
      credentialBinds: this.credentialMountManager?.getBindMounts(),
      environmentId: request.environmentId,
      environmentName: envConfig.environmentName,
    });

    const image = this.config.workerImagePrefix + this.config.workerImage;

    const containerInfo: ContainerInfo = {
      id: container.id,
      name,
      displayName: request.displayName || undefined,
      repos: repos.length > 0 ? repos : undefined,
      status: 'running',
      createdAt: new Date().toISOString(),
      image,
      imageId: '',
      labels: {},
    };

    this.containers.set(container.id, containerInfo);

    if (this.workerStore) {
      await this.workerStore.upsert({
        id: container.id,
        name,
        displayName: request.displayName || undefined,
        environmentId: request.environmentId,
        environmentName: envConfig.environmentName,
        createdAt: containerInfo.createdAt,
        repos: repos.length > 0 ? repos : undefined,
        cpuLimit,
        memoryLimit,
        networkMode: envConfig.networkMode,
        dockerEnabled,
        image,
        imageId: '',
        labels: {},
        status: 'active',
      });
    }

    return containerInfo;
  }

  private assertRunning(id: string): ContainerInfo {
    const info = this.containers.get(id);
    if (!info || info.status !== 'running') {
      throw new Error('Worker container is not running');
    }
    return info;
  }

  async uploadToWorkspace(id: string, tarBuffer: Buffer): Promise<void> {
    this.assertRunning(id);
    await this.dockerService.putWorkspaceArchive(id, tarBuffer);
  }

  async downloadWorkspace(id: string): Promise<NodeJS.ReadableStream> {
    this.assertRunning(id);
    return this.dockerService.getWorkspaceArchive(id);
  }

  async stop(id: string): Promise<void> {
    await this.dockerService.stopContainer(id);
    const info = this.containers.get(id);
    if (info) {
      info.status = 'stopped';
    }
  }

  async restart(id: string): Promise<void> {
    await this.dockerService.restartContainer(id);
    const info = this.containers.get(id);
    if (info) {
      info.status = 'running';
    }
  }

  async remove(id: string): Promise<void> {
    const info = this.containers.get(id);
    await this.dockerService.removeContainer(id);
    if (info?.name) {
      await this.dockerService.removeVolume(`${info.name}-docker`);
      await this.dockerService.removeVolume(`${info.name}-workspace`);
      if (this.workerStore) {
        await this.workerStore.delete(info.name).catch((err) => {
          console.error(`[container] failed to delete worker record '${info.name}':`, err instanceof Error ? err.message : err);
        });
      }
    }
    this.containers.delete(id);
  }

  async archive(id: string): Promise<void> {
    const info = this.containers.get(id);
    if (!info) throw new Error('Container not found');

    if (info.status === 'running') {
      await this.dockerService.stopContainer(id);
    }

    await this.dockerService.removeContainer(id);

    await this.dockerService.removeVolume(`${info.name}-docker`);

    if (this.workerStore) {
      await this.workerStore.upsert(this.containerInfoToWorkerRecord(info));
      await this.workerStore.archive(info.name);
    }

    this.containers.delete(id);
  }

  async unarchive(name: string): Promise<ContainerInfo> {
    if (!this.workerStore) throw new Error('WorkerStore not available');

    const worker = this.workerStore.get(name);
    if (!worker || worker.status !== 'archived') {
      throw new Error('Archived worker not found');
    }

    // Resolve environment config (graceful fallback if environment was deleted)
    let envConfig: ResolvedEnvConfig = {};
    try {
      envConfig = this.resolveEnvironmentConfig(worker.environmentId);
    } catch {
      // Environment may have been deleted since archival — use worker defaults
    }

    const cpuLimit = envConfig.cpuLimit ?? worker.cpuLimit ?? this.config.defaultCpuLimit ?? undefined;
    const memoryLimit = envConfig.memoryLimit || worker.memoryLimit || this.config.defaultMemoryLimit || undefined;
    const dockerEnabled = envConfig.dockerEnabled ?? worker.dockerEnabled ?? true;

    const allCustomEnvVars = [
      ...getAllAgentEnvVars(this.config),
      ...(envConfig.customEnvVars || []),
    ];

    const container = await this.dockerService.createWorkerContainer({
      name: worker.name,
      displayName: worker.displayName,
      repos: worker.repos,
      cpuLimit,
      memoryLimit,
      networkMode: envConfig.networkMode || worker.networkMode,
      allowedDomains: envConfig.allowedDomains,
      setupScriptB64: envConfig.setupScriptB64,
      initScriptB64: envConfig.initScriptB64,
      customEnvVars: allCustomEnvVars.length > 0 ? allCustomEnvVars : undefined,
      dockerEnabled,
      credentialBinds: this.credentialMountManager?.getBindMounts(),
      environmentId: worker.environmentId,
      environmentName: envConfig.environmentName || worker.environmentName,
    });

    await this.workerStore.unarchive(worker.name, container.id);

    const image = this.config.workerImagePrefix + this.config.workerImage;
    const containerInfo: ContainerInfo = {
      id: container.id,
      name: worker.name,
      displayName: worker.displayName,
      repos: worker.repos,
      status: 'running',
      createdAt: worker.createdAt,
      image,
      imageId: '',
      labels: {},
    };

    this.containers.set(container.id, containerInfo);
    return containerInfo;
  }

  async deleteArchived(name: string): Promise<void> {
    if (!this.workerStore) throw new Error('WorkerStore not available');

    const worker = this.workerStore.get(name);
    if (!worker || worker.status !== 'archived') {
      throw new Error('Archived worker not found');
    }

    await this.dockerService.removeVolume(`${name}-workspace`);
    await this.dockerService.removeVolume(`${name}-docker`);
    await this.workerStore.delete(name);
  }

  listArchived(): WorkerRecord[] {
    return this.workerStore?.listArchived() ?? [];
  }

  async reconcileWorkers(): Promise<void> {
    if (!this.workerStore) return;

    const activeNames = new Set<string>();
    for (const [, info] of this.containers) {
      activeNames.add(info.name);
      const existing = this.workerStore.get(info.name);
      if (!existing || existing.status === 'active') {
        // Always update active workers with latest Docker state (labels, image, etc.)
        await this.workerStore.upsert(this.containerInfoToWorkerRecord(info));
      }
    }

    for (const worker of this.workerStore.listActive()) {
      if (!activeNames.has(worker.name)) {
        await this.workerStore.archive(worker.name);
      }
    }
  }

  private containerInfoToWorkerRecord(info: ContainerInfo): WorkerRecord {
    return {
      id: info.id,
      name: info.name,
      displayName: info.displayName,
      environmentId: info.labels['agentor.environment-id'],
      environmentName: info.labels['agentor.environment-name'],
      createdAt: info.createdAt,
      repos: info.repos,
      cpuLimit: parseLabelFloat(info.labels['agentor.cpu-limit']),
      memoryLimit: info.labels['agentor.memory-limit'] || undefined,
      networkMode: info.labels['agentor.network-mode'] as NetworkMode | undefined,
      dockerEnabled: info.labels['agentor.docker-enabled'] === 'true',
      image: info.image,
      imageId: info.imageId,
      labels: info.labels,
      status: 'active',
    };
  }

  async logs(id: string, tail?: number): Promise<string> {
    return this.dockerService.getLogs(id, tail);
  }

  async listTmuxWindows(id: string): Promise<TmuxWindow[]> {
    return this.dockerService.execListTmuxWindows(id);
  }

  async createTmuxWindow(id: string, name?: string): Promise<string> {
    const windowName = name || `shell-${nanoid(4)}`;
    await this.dockerService.execTmux(id, ['new-window', '-t', 'main', '-n', windowName]);
    return windowName;
  }

  async renameTmuxWindow(id: string, oldName: string, newName: string): Promise<void> {
    await this.dockerService.execTmux(id, ['rename-window', '-t', `main:${oldName}`, newName]);
  }

  async killTmuxWindow(id: string, windowName: string): Promise<void> {
    if (windowName === 'shell') {
      throw new Error('Cannot kill the main tmux window');
    }
    await this.dockerService.execTmux(id, ['kill-window', '-t', `main:${windowName}`]);
  }

  getServiceStatus(workerId: string): ServiceStatus {
    const info = this.containers.get(workerId);
    return {
      running: info?.status === 'running',
      containerId: workerId,
    };
  }

  // --- Generic app instance methods ---

  async listAppInstances(workerId: string, appTypeId: string): Promise<AppInstanceInfo[]> {
    const info = this.containers.get(workerId);
    if (!info || info.status !== 'running') return [];
    return this.dockerService.listAppInstances(workerId, appTypeId);
  }

  async createAppInstance(workerId: string, appTypeId: string): Promise<{ id: string; port: number }> {
    this.assertRunning(workerId);

    const appType = getAppType(appTypeId);
    if (!appType) {
      throw new Error(`Unknown app type: ${appTypeId}`);
    }

    const existing = await this.dockerService.listAppInstances(workerId, appTypeId);

    if (existing.length >= appType.maxInstances) {
      throw new Error(`Maximum ${appType.displayName} instances reached (${appType.maxInstances})`);
    }

    // Allocate port from the app type's first port range
    const portDef = appType.ports[0];
    if (!portDef) throw new Error(`No port range defined for ${appType.displayName}`);
    const usedPorts = new Set(existing.map((i) => i.port));

    let port: number | null = null;
    for (let p = portDef.internalPortStart; p <= portDef.internalPortEnd; p++) {
      if (!usedPorts.has(p)) {
        port = p;
        break;
      }
    }

    if (port === null) {
      throw new Error(`No available ports for ${appType.displayName}`);
    }

    const id = `${appTypeId}-${Date.now().toString(36)}`;
    await this.dockerService.startAppInstance(workerId, appTypeId, id, port);
    return { id, port };
  }

  async stopAppInstance(workerId: string, appTypeId: string, instanceId: string): Promise<void> {
    this.assertRunning(workerId);
    await this.dockerService.stopAppInstance(workerId, appTypeId, instanceId);
  }
}
