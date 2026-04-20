import { nanoid } from 'nanoid';
import { uniqueNamesGenerator, adjectives, animals } from 'unique-names-generator';
import type { Config } from './config';
import { getAppType } from './apps';
import { DockerService } from './docker';
import type { EnvironmentJsonPayload, CapabilityJsonEntry, InstructionJsonEntry, WorkerJsonPayload } from './docker';
import { zeroUserEnvVars } from './user-env-store';
import type { AppInstanceInfo, TmuxWindow } from '../../shared/types';
import { getAllGitCloneDomains } from './git-providers';
import { getAllAgentApiDomains } from './agent-config';
import { getPackageManagerDomains } from './environments';
import type { EnvironmentStore } from './environments';
import type { WorkerStore, WorkerRecord } from './worker-store';
import type { UserCredentialManager } from './user-credentials';
import type { UserEnvVarStore } from './user-env-store';
import type { CapabilityStore } from './capability-store';
import type { InstructionStore } from './instruction-store';
import type { StorageManager } from './storage';
import type { NetworkMode, ExposeApis, ServiceStatus, VsCodeTunnelStatus, ContainerInfo, ContainerStatus, CreateContainerRequest, UserEnvVars } from '../../shared/types';


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

const WORKER_MANAGED_LABEL = 'agentor.managed';
const WORKER_USER_ID_LABEL = 'agentor.user-id';
const WORKER_NAME_LABEL = 'agentor.worker-name';

/** Sanitize a user-provided worker name: lowercase, hyphen-safe, <=48 chars.
 * Matches the Docker container name charset when combined with
 * `<containerPrefix>-<userId>-<name>`. */
function sanitizeWorkerName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

export class ContainerManager {
  private containers: Map<string, ContainerInfo> = new Map();
  private dockerService: DockerService;
  private config: Config;
  private environmentStore?: EnvironmentStore;
  private workerStore?: WorkerStore;
  private userCredentialManager?: UserCredentialManager;
  private userEnvStore?: UserEnvVarStore;
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

  setUserCredentialManager(manager: UserCredentialManager): void {
    this.userCredentialManager = manager;
  }

  setUserEnvStore(store: UserEnvVarStore): void {
    this.userEnvStore = store;
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

  /** Build a Docker-safe globally unique container name from userId + worker name. */
  buildContainerName(userId: string, name: string): string {
    return `${this.config.containerPrefix}-${userId}-${name}`;
  }

  /** VS Code tunnel name — must be 3-20 alphanumeric + hyphens. Combine a short
   * userId prefix with the worker name so two users with the same short name
   * do not collide. */
  private buildTunnelName(userId: string, name: string): string {
    const shortId = userId.slice(0, 8);
    return `${shortId}-${name}`.slice(0, 20);
  }

  private async resolveUserEnvAndBinds(userId: string): Promise<{ userEnv: UserEnvVars; credentialBinds: string[] }> {
    const userEnv = this.userEnvStore?.getOrDefault(userId) ?? zeroUserEnvVars(userId);
    let credentialBinds: string[] = [];
    if (this.userCredentialManager && userId) {
      await this.userCredentialManager.ensureUserDir(userId);
      credentialBinds = this.userCredentialManager.getBindMountsForUser(userId);
    }
    return { userEnv, credentialBinds };
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
    const env = this.environmentStore.getById(resolvedId);
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
      const containerName = dc.Names[0]?.replace(/^\//, '') || dc.Id.slice(0, 12);
      const labels = dc.Labels ?? {};
      const labelUserId = labels[WORKER_USER_ID_LABEL] ?? '';
      const labelName = labels[WORKER_NAME_LABEL] ?? '';

      // Prefer the store's record (authoritative metadata), fall back to labels.
      const worker = labelUserId && labelName
        ? this.workerStore?.get(labelUserId, labelName)
        : this.workerStore?.findByContainerName(containerName);

      const userId = worker?.userId ?? labelUserId ?? '';
      const name = worker?.name ?? labelName ?? containerName;

      this.containers.set(dc.Id, {
        id: dc.Id,
        name,
        containerName,
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
        userId,
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

  /** Find an active container by its globally unique Docker container name. */
  findByContainerName(containerName: string): ContainerInfo | undefined {
    for (const c of this.containers.values()) {
      if (c.containerName === containerName) return c;
    }
    return undefined;
  }

  /** Find an active container owned by `userId` with user-facing name `name`. */
  findByUserAndName(userId: string, name: string): ContainerInfo | undefined {
    for (const c of this.containers.values()) {
      if (c.userId === userId && c.name === name) return c;
    }
    return undefined;
  }

  /** Generate a short, per-user-unique worker name. */
  generateName(userId: string): string {
    for (let attempt = 0; attempt < 6; attempt++) {
      const candidate = uniqueNamesGenerator({
        dictionaries: [adjectives, animals],
        separator: '-',
        style: 'lowerCase',
      });
      if (!this.workerStore?.has(userId, candidate) && !this.findByUserAndName(userId, candidate)) {
        return candidate;
      }
    }
    // Fallback: guarantee uniqueness with a short suffix.
    return `worker-${nanoid(6).toLowerCase()}`;
  }

  async create(request: CreateContainerRequest): Promise<ContainerInfo> {
    const userId = request.userId ?? '';
    if (!userId) throw new Error('create: userId is required');

    const envConfig = this.resolveEnvironmentConfig(request.environmentId);

    const rawName = request.name || this.generateName(userId);
    const name = sanitizeWorkerName(rawName);
    if (!name) throw new Error('Worker name must contain at least one alphanumeric character');
    if (this.workerStore?.has(userId, name) || this.findByUserAndName(userId, name)) {
      throw new Error(`You already have a worker named '${name}'`);
    }
    const containerName = this.buildContainerName(userId, name);

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

    const { userEnv, credentialBinds } = await this.resolveUserEnvAndBinds(userId);

    const container = await this.dockerService.createWorkerContainer({
      userId,
      name,
      containerName,
      displayName: request.displayName || undefined,
      cpuLimit,
      memoryLimit,
      mounts: request.mounts,
      dockerEnabled,
      credentialBinds,
      environmentJson: envConfig.environmentJson,
      capabilitiesJson: envConfig.capabilitiesJson,
      instructionsJson: envConfig.instructionsJson,
      workerJson,
      storageManager: this.storageManager,
      userEnv,
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
      containerName,
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
      userId,
      gitName: gitName || undefined,
      gitEmail: gitEmail || undefined,
    };

    this.containers.set(container.id, containerInfo);

    if (this.workerStore) {
      await this.workerStore.upsert(this.containerInfoToWorkerRecord(containerInfo));
    }

    // Attach log collector to the new container
    useLogCollector().attach(containerName, container.id, 'worker', request.displayName || undefined).catch(() => {});

    useLogger().info(`[container] created worker ${containerName} (${container.id.slice(0, 12)})`);

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
      useLogger().info(`[container] stopped ${info.containerName}`);
    }
  }

  async restart(id: string): Promise<void> {
    useLogCollector().detach(id);
    await this.dockerService.restartContainer(id);
    const info = this.containers.get(id);
    if (info) {
      info.status = 'running';
      useLogCollector().attach(info.containerName, id, 'worker', info.displayName).catch(() => {});
      useLogger().info(`[container] restarted ${info.containerName}`);
    }
  }

  async remove(id: string): Promise<void> {
    useLogCollector().detach(id);
    const info = this.containers.get(id);
    await this.dockerService.removeContainer(id);
    if (info) {
      await cleanupWorkerMappings(info.containerName);
      if (this.storageManager) {
        await this.storageManager.removeWorkerDocker(info.containerName);
        await this.storageManager.removeWorkerWorkspace(info.userId, info.name, info.containerName);
        await this.storageManager.removeWorkerAgents(info.userId, info.name, info.containerName);
      }
      if (this.workerStore) {
        await this.workerStore.delete(info.userId, info.name).catch((err) => {
          useLogger().error(`[container] failed to delete worker record '${info.containerName}': ${err instanceof Error ? err.message : err}`);
        });
      }
      useLogger().info(`[container] removed ${info.containerName}`);
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
      await this.workerStore.archive(info.userId, info.name);
    }

    useLogger().info(`[container] archived ${info.containerName}`);
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

    const { userEnv, credentialBinds } = await this.resolveUserEnvAndBinds(info.userId);

    const container = await this.dockerService.createWorkerContainer({
      userId: info.userId,
      name: info.name,
      containerName: info.containerName,
      displayName: info.displayName,
      cpuLimit,
      memoryLimit,
      dockerEnabled,
      credentialBinds,
      environmentJson: envConfig.environmentJson,
      capabilitiesJson: envConfig.capabilitiesJson,
      instructionsJson: envConfig.instructionsJson,
      workerJson,
      storageManager: this.storageManager,
      userEnv,
    });

    const image = this.config.workerImagePrefix + this.config.workerImage;
    const containerInfo: ContainerInfo = {
      id: container.id,
      name: info.name,
      containerName: info.containerName,
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

    // Mappings reconcile on Traefik restart — they key by containerName which is unchanged.
    await reassignWorkerMappings(info.containerName);

    useLogCollector().attach(info.containerName, container.id, 'worker', info.displayName).catch(() => {});

    useLogger().info(`[container] rebuilt ${info.containerName} (${container.id.slice(0, 12)})`);

    return containerInfo;
  }

  async unarchive(userId: string, name: string): Promise<ContainerInfo> {
    if (!this.workerStore) throw new Error('WorkerStore not available');

    const worker = this.workerStore.get(userId, name);
    if (!worker || worker.status !== 'archived') {
      throw new Error('Archived worker not found');
    }

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
      capabilitiesJson: worker.capabilityNames?.map((n) => ({ name: n, content: '' })) || [],
      instructionsJson: worker.instructionNames?.map((n) => ({ name: n, content: '' })) || [],
    };
    try {
      envConfig = this.resolveEnvironmentConfig(worker.environmentId);
    } catch {
      // Environment may have been deleted — use snapshotted worker data
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

    const { userEnv, credentialBinds } = await this.resolveUserEnvAndBinds(worker.userId);

    const container = await this.dockerService.createWorkerContainer({
      userId: worker.userId,
      name: worker.name,
      containerName: worker.containerName,
      displayName: worker.displayName,
      cpuLimit,
      memoryLimit,
      dockerEnabled,
      credentialBinds,
      environmentJson: envConfig.environmentJson,
      capabilitiesJson: envConfig.capabilitiesJson,
      instructionsJson: envConfig.instructionsJson,
      workerJson,
      storageManager: this.storageManager,
      userEnv,
    });

    await this.workerStore.unarchive(worker.userId, worker.name, container.id);

    const image = this.config.workerImagePrefix + this.config.workerImage;
    const containerInfo: ContainerInfo = {
      id: container.id,
      name: worker.name,
      containerName: worker.containerName,
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

    await reassignWorkerMappings(worker.containerName);

    useLogCollector().attach(worker.containerName, container.id, 'worker', worker.displayName).catch(() => {});

    useLogger().info(`[container] unarchived ${worker.containerName} (${container.id.slice(0, 12)})`);

    return containerInfo;
  }

  async deleteArchived(userId: string, name: string): Promise<void> {
    if (!this.workerStore) throw new Error('WorkerStore not available');

    const worker = this.workerStore.get(userId, name);
    if (!worker || worker.status !== 'archived') {
      throw new Error('Archived worker not found');
    }

    await cleanupWorkerMappings(worker.containerName);

    if (this.storageManager) {
      await this.storageManager.removeWorkerWorkspace(worker.userId, worker.name, worker.containerName);
      await this.storageManager.removeWorkerDocker(worker.containerName);
      await this.storageManager.removeWorkerAgents(worker.userId, worker.name, worker.containerName);
    }
    await this.workerStore.delete(worker.userId, worker.name);
  }

  listArchived(): WorkerRecord[] {
    return this.workerStore?.listArchived() ?? [];
  }

  async reconcileWorkers(): Promise<void> {
    if (!this.workerStore) return;

    const activeContainerNames = new Set<string>();
    for (const [, info] of this.containers) {
      activeContainerNames.add(info.containerName);
      const existing = this.workerStore.get(info.userId, info.name);
      if (!existing || existing.status === 'active') {
        await this.workerStore.upsert(this.containerInfoToWorkerRecord(info));
      }
    }

    for (const worker of this.workerStore.listActive()) {
      if (!activeContainerNames.has(worker.containerName)) {
        await this.workerStore.archive(worker.userId, worker.name);
      }
    }
  }

  private containerInfoToWorkerRecord(info: ContainerInfo): WorkerRecord {
    return {
      id: info.id,
      name: info.name,
      containerName: info.containerName,
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
    const tunnelName = this.buildTunnelName(info.userId, info.name);
    const output = await this.dockerService.execVsCodeTunnel(workerId, ['start', tunnelName]);
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
