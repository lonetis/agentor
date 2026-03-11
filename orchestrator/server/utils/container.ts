import { nanoid } from 'nanoid';
import { uniqueNamesGenerator, adjectives, animals } from 'unique-names-generator';
import type { Config } from './config';
import { getAppType } from './apps';
import { DockerService } from './docker';
import type { EnvironmentJsonPayload, SkillJsonEntry, AgentsMdJsonEntry, WorkerJsonPayload } from './docker';
import type { AppInstanceInfo, TmuxWindow } from '../../shared/types';
import { getAllGitCloneDomains } from './git-providers';
import { getAllAgentApiDomains } from './agent-config';
import { getPackageManagerDomains } from './environments';
import type { EnvironmentStore } from './environments';
import type { WorkerStore, WorkerRecord } from './worker-store';
import type { CredentialMountManager } from './credential-mounts';
import type { SkillStore } from './skill-store';
import type { AgentsMdStore } from './agents-md-store';
import type { StorageManager } from './storage';
import type { NetworkMode, ExposeApis, ServiceStatus, ContainerInfo, ContainerStatus, CreateContainerRequest } from '../../shared/types';


interface ResolvedEnvConfig {
  cpuLimit?: number;
  memoryLimit?: string;
  dockerEnabled?: boolean;
  environmentName?: string;
  includePackageManagerDomains?: boolean;
  environmentJson: EnvironmentJsonPayload;
  skillsJson: SkillJsonEntry[];
  agentsMdJson: AgentsMdJsonEntry[];
}

export class ContainerManager {
  private containers: Map<string, ContainerInfo> = new Map();
  private dockerService: DockerService;
  private config: Config;
  private environmentStore?: EnvironmentStore;
  private workerStore?: WorkerStore;
  private credentialMountManager?: CredentialMountManager;
  private skillStore?: SkillStore;
  private agentsMdStore?: AgentsMdStore;
  private storageManager?: StorageManager;
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

  setSkillStore(store: SkillStore): void {
    this.skillStore = store;
  }

  setAgentsMdStore(store: AgentsMdStore): void {
    this.agentsMdStore = store;
  }

  setStorageManager(manager: StorageManager): void {
    this.storageManager = manager;
  }

  private resolveSkillsAndAgentsMd(
    enabledSkillIds: string[] | null | undefined,
    enabledAgentsMdIds: string[] | null | undefined,
    exposeApis: ExposeApis,
  ): { skillsJson: SkillJsonEntry[]; agentsMdJson: AgentsMdJsonEntry[] } {
    const agentsMdJson: AgentsMdJsonEntry[] = [];
    if (this.agentsMdStore) {
      const allEntries = this.agentsMdStore.list();
      const enabledEntries = enabledAgentsMdIds === null || enabledAgentsMdIds === undefined
        ? allEntries
        : allEntries.filter((i) => enabledAgentsMdIds!.includes(i.id));

      for (const entry of enabledEntries) {
        agentsMdJson.push({ name: entry.name, content: entry.content });
      }
    }

    const skillsJson: SkillJsonEntry[] = [];
    if (this.skillStore) {
      const allSkills = this.skillStore.list();
      let enabledSkills = enabledSkillIds === null || enabledSkillIds === undefined
        ? allSkills
        : allSkills.filter((s) => enabledSkillIds!.includes(s.id));

      const apiSkillFilter: Record<string, keyof ExposeApis> = {
        'port-mapping': 'portMappings',
        'domain-mapping': 'domainMappings',
        'usage': 'usage',
      };
      enabledSkills = enabledSkills.filter((s) => {
        const apiKey = apiSkillFilter[s.id];
        return !apiKey || exposeApis[apiKey];
      });

      for (const skill of enabledSkills) {
        skillsJson.push({ name: skill.name, content: skill.content });
      }
    }

    return { skillsJson, agentsMdJson };
  }

  private resolveEnvironmentConfig(environmentId?: string): ResolvedEnvConfig {
    const defaultExposeApis: ExposeApis = { portMappings: true, domainMappings: true, usage: true };

    if (!this.environmentStore) {
      const { skillsJson, agentsMdJson } = this.resolveSkillsAndAgentsMd(null, null, defaultExposeApis);
      return {
        includePackageManagerDomains: true,
        environmentJson: {
          networkMode: 'full',
          allowedDomains: [],
          dockerEnabled: true,
          setupScript: '',
          envVars: '',
          exposeApis: defaultExposeApis,
        },
        skillsJson,
        agentsMdJson,
      };
    }

    const resolvedId = environmentId || 'default';
    const env = this.environmentStore.get(resolvedId);
    if (!env) throw new Error(`Environment not found: ${resolvedId}`);

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
      domains.push(...(getAllAgentApiDomains()));
      domains.push(...getAllGitCloneDomains());
    }

    const exposeApis: ExposeApis = env.exposeApis ?? defaultExposeApis;
    const { skillsJson, agentsMdJson } = this.resolveSkillsAndAgentsMd(
      env.enabledSkillIds, env.enabledAgentsMdIds, exposeApis,
    );

    const dockerEnabled = env.dockerEnabled ?? true;

    return {
      cpuLimit: env.cpuLimit != null ? env.cpuLimit : undefined,
      memoryLimit: env.memoryLimit || undefined,
      dockerEnabled,
      environmentName: env.name,
      includePackageManagerDomains: env.includePackageManagerDomains ?? false,
      environmentJson: {
        networkMode: env.networkMode || 'full',
        allowedDomains: domains,
        dockerEnabled,
        setupScript: env.setupScript || '',
        envVars: env.envVars || '',
        exposeApis,
      },
      skillsJson,
      agentsMdJson,
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
      const name = dc.Names[0]?.replace(/^\//, '') || dc.Id.slice(0, 12);
      const worker = this.workerStore?.get(name);

      this.containers.set(dc.Id, {
        id: dc.Id,
        name,
        displayName: worker?.displayName,
        repos: worker?.repos,
        mounts: worker?.mounts,
        initScript: worker?.initScript,
        status: ContainerManager.STATE_MAP[dc.State] || 'error',
        createdAt: worker?.createdAt || '',
        image: dc.Image,
        imageId: dc.ImageID,
        environmentId: worker?.environmentId,
        environmentName: worker?.environmentName,
        cpuLimit: worker?.cpuLimit,
        memoryLimit: worker?.memoryLimit,
        networkMode: worker?.networkMode,
        dockerEnabled: worker?.dockerEnabled,
        allowedDomains: worker?.allowedDomains,
        includePackageManagerDomains: worker?.includePackageManagerDomains,
        setupScript: worker?.setupScript,
        envVars: worker?.envVars,
        exposeApis: worker?.exposeApis,
        skillNames: worker?.skillNames,
        agentsMdNames: worker?.agentsMdNames,
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
    return `${this.config.containerPrefix}-${uniqueNamesGenerator({
      dictionaries: [adjectives, animals],
      separator: '-',
      style: 'lowerCase',
    })}`;
  }

  async create(request: CreateContainerRequest): Promise<ContainerInfo> {
    const envConfig = this.resolveEnvironmentConfig(request.environmentId);

    const name = request.name || this.generateName();
    const repos = request.repos?.filter((r) => r.url) || [];

    const cpuLimit = envConfig.cpuLimit ?? request.cpuLimit ?? this.config.defaultCpuLimit ?? undefined;
    const memoryLimit = envConfig.memoryLimit || request.memoryLimit || this.config.defaultMemoryLimit || undefined;
    const dockerEnabled = envConfig.dockerEnabled ?? true;

    const workerJson: WorkerJsonPayload = {
      name,
      displayName: request.displayName || '',
      repos,
      initScript: request.initScript?.trim() || '',
    };

    const container = await this.dockerService.createWorkerContainer({
      name,
      displayName: request.displayName || undefined,
      cpuLimit,
      memoryLimit,
      mounts: request.mounts,
      dockerEnabled,
      credentialBinds: this.credentialMountManager?.getBindMounts(),
      environmentJson: envConfig.environmentJson,
      skillsJson: envConfig.skillsJson,
      agentsMdJson: envConfig.agentsMdJson,
      workerJson,
      storageManager: this.storageManager,
    });

    const image = this.config.workerImagePrefix + this.config.workerImage;

    const networkMode = envConfig.environmentJson.networkMode as NetworkMode;

    const mounts = request.mounts?.length ? request.mounts : undefined;
    const initScript = request.initScript?.trim() || undefined;
    const allowedDomains = envConfig.environmentJson.allowedDomains.length > 0 ? envConfig.environmentJson.allowedDomains : undefined;
    const setupScript = envConfig.environmentJson.setupScript || undefined;
    const envVars = envConfig.environmentJson.envVars || undefined;
    const exposeApis = envConfig.environmentJson.exposeApis;
    const skillNames = envConfig.skillsJson.length > 0 ? envConfig.skillsJson.map((s) => s.name) : undefined;
    const agentsMdNames = envConfig.agentsMdJson.length > 0 ? envConfig.agentsMdJson.map((e) => e.name) : undefined;

    const containerInfo: ContainerInfo = {
      id: container.id,
      name,
      displayName: request.displayName || undefined,
      repos: repos.length > 0 ? repos : undefined,
      mounts,
      initScript,
      status: 'running',
      createdAt: new Date().toISOString(),
      image,
      imageId: '',
      environmentId: request.environmentId,
      environmentName: envConfig.environmentName,
      cpuLimit,
      memoryLimit,
      networkMode,
      dockerEnabled,
      allowedDomains,
      includePackageManagerDomains: envConfig.includePackageManagerDomains,
      setupScript,
      envVars,
      exposeApis,
      skillNames,
      agentsMdNames,
    };

    this.containers.set(container.id, containerInfo);

    if (this.workerStore) {
      await this.workerStore.upsert(this.containerInfoToWorkerRecord(containerInfo));
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
      if (this.storageManager) {
        await this.storageManager.removeWorkerDocker(info.name);
        await this.storageManager.removeWorkerWorkspace(info.name);
      } else {
        await this.dockerService.removeVolume(`${info.name}-docker`);
        await this.dockerService.removeVolume(`${info.name}-workspace`);
      }
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

    // Resolve environment config (graceful fallback to snapshotted worker data if environment was deleted)
    const defaultExposeApis: ExposeApis = { portMappings: true, domainMappings: true, usage: true };
    let envConfig: ResolvedEnvConfig = {
      environmentJson: {
        networkMode: worker.networkMode || 'full',
        allowedDomains: worker.allowedDomains || [],
        dockerEnabled: worker.dockerEnabled ?? true,
        setupScript: worker.setupScript || '',
        envVars: worker.envVars || '',
        exposeApis: worker.exposeApis || defaultExposeApis,
      },
      includePackageManagerDomains: worker.includePackageManagerDomains,
      skillsJson: worker.skillNames?.map((name) => ({ name, content: '' })) || [],
      agentsMdJson: worker.agentsMdNames?.map((name) => ({ name, content: '' })) || [],
    };
    try {
      envConfig = this.resolveEnvironmentConfig(worker.environmentId);
    } catch {
      // Environment may have been deleted since archival — use snapshotted worker data
    }

    const cpuLimit = envConfig.cpuLimit ?? worker.cpuLimit ?? this.config.defaultCpuLimit ?? undefined;
    const memoryLimit = envConfig.memoryLimit || worker.memoryLimit || this.config.defaultMemoryLimit || undefined;
    const dockerEnabled = envConfig.dockerEnabled ?? worker.dockerEnabled ?? true;

    const workerJson: WorkerJsonPayload = {
      name: worker.name,
      displayName: worker.displayName || '',
      repos: worker.repos || [],
      initScript: worker.initScript || '',
    };

    const container = await this.dockerService.createWorkerContainer({
      name: worker.name,
      displayName: worker.displayName,
      cpuLimit,
      memoryLimit,
      dockerEnabled,
      credentialBinds: this.credentialMountManager?.getBindMounts(),
      environmentJson: envConfig.environmentJson,
      skillsJson: envConfig.skillsJson,
      agentsMdJson: envConfig.agentsMdJson,
      workerJson,
      storageManager: this.storageManager,
    });

    await this.workerStore.unarchive(worker.name, container.id);

    const image = this.config.workerImagePrefix + this.config.workerImage;
    const containerInfo: ContainerInfo = {
      id: container.id,
      name: worker.name,
      displayName: worker.displayName,
      repos: worker.repos,
      mounts: worker.mounts,
      initScript: worker.initScript,
      status: 'running',
      createdAt: worker.createdAt,
      image,
      imageId: '',
      environmentId: worker.environmentId,
      environmentName: envConfig.environmentName || worker.environmentName,
      cpuLimit,
      memoryLimit,
      networkMode: worker.networkMode,
      dockerEnabled,
      allowedDomains: worker.allowedDomains,
      includePackageManagerDomains: worker.includePackageManagerDomains,
      setupScript: worker.setupScript,
      envVars: worker.envVars,
      exposeApis: worker.exposeApis,
      skillNames: worker.skillNames,
      agentsMdNames: worker.agentsMdNames,
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

    if (this.storageManager) {
      await this.storageManager.removeWorkerWorkspace(name);
      await this.storageManager.removeWorkerDocker(name);
    } else {
      await this.dockerService.removeVolume(`${name}-workspace`);
      await this.dockerService.removeVolume(`${name}-docker`);
    }
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
        // Always update active workers with latest Docker state (image, etc.)
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
      environmentId: info.environmentId,
      environmentName: info.environmentName,
      createdAt: info.createdAt,
      repos: info.repos,
      mounts: info.mounts,
      initScript: info.initScript,
      cpuLimit: info.cpuLimit,
      memoryLimit: info.memoryLimit,
      networkMode: info.networkMode,
      dockerEnabled: info.dockerEnabled,
      allowedDomains: info.allowedDomains,
      includePackageManagerDomains: info.includePackageManagerDomains,
      setupScript: info.setupScript,
      envVars: info.envVars,
      exposeApis: info.exposeApis,
      skillNames: info.skillNames,
      agentsMdNames: info.agentsMdNames,
      image: info.image,
      imageId: info.imageId,
      status: 'active',
    };
  }

  async logs(id: string, tail?: number): Promise<string> {
    return this.dockerService.getLogs(id, tail);
  }

  async listTmuxWindows(id: string): Promise<TmuxWindow[]> {
    return this.dockerService.execListTmuxWindows(id);
  }

  async createTmuxWindow(id: string, name?: string): Promise<TmuxWindow> {
    const windowName = name || `shell-${nanoid(4)}`;
    await this.dockerService.execTmux(id, ['new-window', '-t', 'main:', '-n', windowName]);
    // Fetch the newly created window to get its index
    const windows = await this.dockerService.execListTmuxWindows(id);
    const created = windows.findLast((w) => w.name === windowName);
    if (!created) {
      throw new Error('Failed to find newly created tmux window');
    }
    return created;
  }

  async renameTmuxWindow(id: string, windowIndex: number, newName: string): Promise<void> {
    await this.dockerService.execTmux(id, ['rename-window', '-t', `main:${windowIndex}`, newName]);
  }

  async killTmuxWindow(id: string, windowIndex: number): Promise<void> {
    if (windowIndex === 0) {
      throw new Error('Cannot kill the main tmux window');
    }
    await this.dockerService.execTmux(id, ['kill-window', '-t', `main:${windowIndex}`]);
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
