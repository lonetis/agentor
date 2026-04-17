import { nanoid } from 'nanoid';
import { uniqueNamesGenerator, adjectives, animals } from 'unique-names-generator';
import type { Config } from './config';
import { getAppType } from './apps';
import { DockerService } from './docker';
import type { EnvironmentJsonPayload, CapabilityJsonEntry, InstructionJsonEntry, WorkerJsonPayload } from './docker';
import type { AppInstanceInfo, TmuxWindow } from '../../shared/types';
import { getAllGitCloneDomains } from './git-providers';
import { getAllAgentApiDomains } from './agent-config';
import { getPackageManagerDomains } from './environments';
import type { EnvironmentStore } from './environments';
import type { WorkerStore, WorkerRecord } from './worker-store';
import type { CredentialMountManager } from './credential-mounts';
import type { CapabilityStore } from './capability-store';
import type { InstructionStore } from './instruction-store';
import type { StorageManager } from './storage';
import type { NetworkMode, ExposeApis, ServiceStatus, VsCodeTunnelStatus, ContainerInfo, ContainerStatus, CreateContainerRequest } from '../../shared/types';


interface ResolvedEnvConfig {
  cpuLimit?: number;
  memoryLimit?: string;
  dockerEnabled?: boolean;
  environmentName?: string;
  includePackageManagerDomains?: boolean;
  environmentJson: EnvironmentJsonPayload;
  capabilitiesJson: CapabilityJsonEntry[];
  instructionsJson: InstructionJsonEntry[];
}

export class ContainerManager {
  private containers: Map<string, ContainerInfo> = new Map();
  private dockerService: DockerService;
  private config: Config;
  private environmentStore?: EnvironmentStore;
  private workerStore?: WorkerStore;
  private credentialMountManager?: CredentialMountManager;
  private capabilityStore?: CapabilityStore;
  private instructionStore?: InstructionStore;
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

  setCapabilityStore(store: CapabilityStore): void {
    this.capabilityStore = store;
  }

  setInstructionStore(store: InstructionStore): void {
    this.instructionStore = store;
  }

  setStorageManager(manager: StorageManager): void {
    this.storageManager = manager;
  }

  private resolveCapabilitiesAndInstructions(
    enabledCapabilityIds: string[] | null | undefined,
    enabledInstructionIds: string[] | null | undefined,
    exposeApis: ExposeApis,
  ): { capabilitiesJson: CapabilityJsonEntry[]; instructionsJson: InstructionJsonEntry[] } {
    const instructionsJson: InstructionJsonEntry[] = [];
    if (this.instructionStore) {
      const allEntries = this.instructionStore.list();
      const enabledEntries = enabledInstructionIds === null || enabledInstructionIds === undefined
        ? allEntries
        : allEntries.filter((i) => enabledInstructionIds!.includes(i.id));

      for (const entry of enabledEntries) {
        instructionsJson.push({ name: entry.name, content: entry.content });
      }
    }

    const capabilitiesJson: CapabilityJsonEntry[] = [];
    if (this.capabilityStore) {
      const allCapabilities = this.capabilityStore.list();
      let enabledCapabilities = enabledCapabilityIds === null || enabledCapabilityIds === undefined
        ? allCapabilities
        : allCapabilities.filter((s) => enabledCapabilityIds!.includes(s.id));

      const apiCapabilityFilter: Record<string, keyof ExposeApis> = {
        'port-mapping': 'portMappings',
        'domain-mapping': 'domainMappings',
        'usage': 'usage',
      };
      enabledCapabilities = enabledCapabilities.filter((s) => {
        const apiKey = apiCapabilityFilter[s.id];
        return !apiKey || exposeApis[apiKey];
      });

      for (const capability of enabledCapabilities) {
        capabilitiesJson.push({ name: capability.name, content: capability.content });
      }
    }

    return { capabilitiesJson, instructionsJson };
  }

  private resolveEnvironmentConfig(environmentId?: string): ResolvedEnvConfig {
    const defaultExposeApis: ExposeApis = { portMappings: true, domainMappings: true, usage: true };

    if (!this.environmentStore) {
      const { capabilitiesJson, instructionsJson } = this.resolveCapabilitiesAndInstructions(null, null, defaultExposeApis);
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
        capabilitiesJson,
        instructionsJson,
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
    const { capabilitiesJson, instructionsJson } = this.resolveCapabilitiesAndInstructions(
      env.enabledCapabilityIds, env.enabledInstructionIds, exposeApis,
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
      capabilitiesJson,
      instructionsJson,
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
        capabilityNames: worker?.capabilityNames,
        instructionNames: worker?.instructionNames,
        userId: worker?.userId ?? '',
        gitName: worker?.gitName,
        gitEmail: worker?.gitEmail,
      });
    }

    useLogger().debug(`[container] synced ${this.containers.size} containers`);
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

    const gitName = request.gitName || '';
    const gitEmail = request.gitEmail || '';

    const workerJson: WorkerJsonPayload = {
      name,
      displayName: request.displayName || '',
      repos,
      initScript: request.initScript?.trim() || '',
      gitName,
      gitEmail,
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
      capabilitiesJson: envConfig.capabilitiesJson,
      instructionsJson: envConfig.instructionsJson,
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
    const capabilityNames = envConfig.capabilitiesJson.length > 0 ? envConfig.capabilitiesJson.map((s) => s.name) : undefined;
    const instructionNames = envConfig.instructionsJson.length > 0 ? envConfig.instructionsJson.map((e) => e.name) : undefined;

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
      capabilityNames,
      instructionNames,
      userId: request.userId ?? '',
      gitName: gitName || undefined,
      gitEmail: gitEmail || undefined,
    };

    this.containers.set(container.id, containerInfo);

    if (this.workerStore) {
      await this.workerStore.upsert(this.containerInfoToWorkerRecord(containerInfo));
    }

    // Attach log collector to the new container
    useLogCollector().attach(name, container.id, 'worker', request.displayName || undefined).catch(() => {});

    useLogger().info(`[container] created worker ${name} (${container.id.slice(0, 12)})`);

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
    useLogCollector().detach(id);
    await this.dockerService.stopContainer(id);
    const info = this.containers.get(id);
    if (info) {
      info.status = 'stopped';
      useLogger().info(`[container] stopped ${info.name}`);
    }
  }

  async restart(id: string): Promise<void> {
    useLogCollector().detach(id);
    await this.dockerService.restartContainer(id);
    const info = this.containers.get(id);
    if (info) {
      info.status = 'running';
      // Re-attach log collector after restart
      useLogCollector().attach(info.name, id, 'worker', info.displayName).catch(() => {});
      useLogger().info(`[container] restarted ${info.name}`);
    }
  }

  async remove(id: string): Promise<void> {
    useLogCollector().detach(id);
    const info = this.containers.get(id);
    await this.dockerService.removeContainer(id);
    if (info?.name) {
      await cleanupWorkerMappings(info.name);
      if (this.storageManager) {
        await this.storageManager.removeWorkerDocker(info.name);
        await this.storageManager.removeWorkerWorkspace(info.name);
        await this.storageManager.removeWorkerAgents(info.name);
      } else {
        await this.dockerService.removeVolume(`${info.name}-docker`);
        await this.dockerService.removeVolume(`${info.name}-workspace`);
        await this.dockerService.removeVolume(`${info.name}-agents`);
      }
      if (this.workerStore) {
        await this.workerStore.delete(info.name).catch((err) => {
          useLogger().error(`[container] failed to delete worker record '${info.name}': ${err instanceof Error ? err.message : err}`);
        });
      }
    }
    if (info) {
      useLogger().info(`[container] removed ${info.name}`);
    }
    this.containers.delete(id);
  }

  async archive(id: string): Promise<void> {
    useLogCollector().detach(id);
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

    useLogger().info(`[container] archived ${info.name}`);
    this.containers.delete(id);
  }

  async rebuild(id: string): Promise<ContainerInfo> {
    useLogCollector().detach(id);
    const info = this.containers.get(id);
    if (!info) throw new Error('Container not found');

    // Stop and remove the old container — workspace, agents, and DinD volumes
    // are preserved (rebuild behaves identically to archive + unarchive).
    if (info.status === 'running') {
      await this.dockerService.stopContainer(id);
    }
    await this.dockerService.removeContainer(id);

    this.containers.delete(id);

    // Resolve environment config (graceful fallback to current container info if environment was deleted)
    const defaultExposeApis: ExposeApis = { portMappings: true, domainMappings: true, usage: true };
    let envConfig: ResolvedEnvConfig = {
      environmentJson: {
        networkMode: info.networkMode || 'full',
        allowedDomains: info.allowedDomains || [],
        dockerEnabled: info.dockerEnabled ?? true,
        setupScript: info.setupScript || '',
        envVars: info.envVars || '',
        exposeApis: info.exposeApis || defaultExposeApis,
      },
      includePackageManagerDomains: info.includePackageManagerDomains,
      capabilitiesJson: info.capabilityNames?.map((name) => ({ name, content: '' })) || [],
      instructionsJson: info.instructionNames?.map((name) => ({ name, content: '' })) || [],
    };
    try {
      envConfig = this.resolveEnvironmentConfig(info.environmentId);
    } catch {
      // Environment may have been deleted — use current container info
    }

    const cpuLimit = envConfig.cpuLimit ?? info.cpuLimit ?? this.config.defaultCpuLimit ?? undefined;
    const memoryLimit = envConfig.memoryLimit || info.memoryLimit || this.config.defaultMemoryLimit || undefined;
    const dockerEnabled = envConfig.dockerEnabled ?? info.dockerEnabled ?? true;

    const workerJson: WorkerJsonPayload = {
      name: info.name,
      displayName: info.displayName || '',
      repos: info.repos || [],
      initScript: info.initScript || '',
      gitName: info.gitName || '',
      gitEmail: info.gitEmail || '',
    };

    const container = await this.dockerService.createWorkerContainer({
      name: info.name,
      displayName: info.displayName,
      cpuLimit,
      memoryLimit,
      dockerEnabled,
      credentialBinds: this.credentialMountManager?.getBindMounts(),
      environmentJson: envConfig.environmentJson,
      capabilitiesJson: envConfig.capabilitiesJson,
      instructionsJson: envConfig.instructionsJson,
      workerJson,
      storageManager: this.storageManager,
    });

    const image = this.config.workerImagePrefix + this.config.workerImage;
    const containerInfo: ContainerInfo = {
      id: container.id,
      name: info.name,
      displayName: info.displayName,
      repos: info.repos,
      mounts: info.mounts,
      initScript: info.initScript,
      status: 'running',
      createdAt: info.createdAt,
      image,
      imageId: '',
      environmentId: info.environmentId,
      environmentName: envConfig.environmentName || info.environmentName,
      cpuLimit,
      memoryLimit,
      networkMode: info.networkMode,
      dockerEnabled,
      allowedDomains: info.allowedDomains,
      includePackageManagerDomains: info.includePackageManagerDomains,
      setupScript: info.setupScript,
      envVars: info.envVars,
      exposeApis: info.exposeApis,
      capabilityNames: info.capabilityNames,
      instructionNames: info.instructionNames,
      userId: info.userId,
      gitName: info.gitName,
      gitEmail: info.gitEmail,
    };

    this.containers.set(container.id, containerInfo);

    if (this.workerStore) {
      await this.workerStore.upsert(this.containerInfoToWorkerRecord(containerInfo));
    }

    // Reassign persisted port/domain mappings to the new container ID
    await reassignWorkerMappings(info.name, container.id);

    // Attach log collector to the rebuilt container
    useLogCollector().attach(info.name, container.id, 'worker', info.displayName).catch(() => {});

    useLogger().info(`[container] rebuilt ${info.name} (${container.id.slice(0, 12)})`);

    return containerInfo;
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
      capabilitiesJson: worker.capabilityNames?.map((name) => ({ name, content: '' })) || [],
      instructionsJson: worker.instructionNames?.map((name) => ({ name, content: '' })) || [],
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
      gitName: worker.gitName || '',
      gitEmail: worker.gitEmail || '',
    };

    const container = await this.dockerService.createWorkerContainer({
      name: worker.name,
      displayName: worker.displayName,
      cpuLimit,
      memoryLimit,
      dockerEnabled,
      credentialBinds: this.credentialMountManager?.getBindMounts(),
      environmentJson: envConfig.environmentJson,
      capabilitiesJson: envConfig.capabilitiesJson,
      instructionsJson: envConfig.instructionsJson,
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
      capabilityNames: worker.capabilityNames,
      instructionNames: worker.instructionNames,
      userId: worker.userId,
      gitName: worker.gitName,
      gitEmail: worker.gitEmail,
    };

    this.containers.set(container.id, containerInfo);

    // Reassign persisted port/domain mappings to the new container ID
    await reassignWorkerMappings(worker.name, container.id);

    // Attach log collector to the unarchived container
    useLogCollector().attach(worker.name, container.id, 'worker', worker.displayName).catch(() => {});

    useLogger().info(`[container] unarchived ${name} (${container.id.slice(0, 12)})`);

    return containerInfo;
  }

  async deleteArchived(name: string): Promise<void> {
    if (!this.workerStore) throw new Error('WorkerStore not available');

    const worker = this.workerStore.get(name);
    if (!worker || worker.status !== 'archived') {
      throw new Error('Archived worker not found');
    }

    await cleanupWorkerMappings(name);

    if (this.storageManager) {
      await this.storageManager.removeWorkerWorkspace(name);
      await this.storageManager.removeWorkerDocker(name);
      await this.storageManager.removeWorkerAgents(name);
    } else {
      await this.dockerService.removeVolume(`${name}-workspace`);
      await this.dockerService.removeVolume(`${name}-docker`);
      await this.dockerService.removeVolume(`${name}-agents`);
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
      capabilityNames: info.capabilityNames,
      instructionNames: info.instructionNames,
      image: info.image,
      imageId: info.imageId,
      status: 'active',
      userId: info.userId,
      gitName: info.gitName,
      gitEmail: info.gitEmail,
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

  // --- VS Code tunnel methods ---

  async getVsCodeTunnelStatus(workerId: string): Promise<VsCodeTunnelStatus> {
    const info = this.containers.get(workerId);
    if (!info || info.status !== 'running') {
      return { status: 'stopped' };
    }

    try {
      const output = await this.dockerService.execVsCodeTunnel(workerId, ['status']);
      return this.parseVsCodeTunnelOutput(output);
    } catch {
      return { status: 'stopped' };
    }
  }

  async startVsCodeTunnel(workerId: string): Promise<void> {
    this.assertRunning(workerId);
    const info = this.containers.get(workerId)!;
    const name = info.name.replace(/^agentor-worker-/, '');
    const output = await this.dockerService.execVsCodeTunnel(workerId, ['start', name]);
    const trimmed = output.trim();
    if (trimmed.startsWith('ERR:')) {
      throw new Error(trimmed.substring(4));
    }
  }

  async stopVsCodeTunnel(workerId: string): Promise<void> {
    this.assertRunning(workerId);
    await this.dockerService.execVsCodeTunnel(workerId, ['stop']);
  }

  private parseVsCodeTunnelOutput(output: string): VsCodeTunnelStatus {
    const lines = output.trim().split(/\r?\n/).filter(Boolean);
    const result: VsCodeTunnelStatus = { status: 'stopped' };

    for (const line of lines) {
      const [key, ...rest] = line.split(':');
      const value = rest.join(':');
      switch (key) {
        case 'STATUS':
          result.status = value as VsCodeTunnelStatus['status'];
          break;
        case 'MACHINE':
          result.machineName = value;
          break;
        case 'AUTH_URL':
          result.authUrl = value;
          break;
        case 'AUTH_CODE':
          result.authCode = value;
          break;
      }
    }

    return result;
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
