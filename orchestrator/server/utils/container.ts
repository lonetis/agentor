import { randomUUID } from 'node:crypto';
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
import { getPackageManagerDomains, DEFAULT_ENVIRONMENT_ID } from './environments';
import { getUserById } from './auth';
import type { EnvironmentStore } from './environments';
import type { WorkerStore, WorkerRecord } from './worker-store';
import type { UserCredentialManager } from './user-credentials';
import type { UserEnvVarStore } from './user-env-store';
import type { CapabilityStore } from './capability-store';
import type { InstructionStore } from './instruction-store';
import type { StorageManager } from './storage';
import type { ExposeApis, ServiceStatus, ContainerInfo, ContainerStatus, CreateContainerRequest, UpdateContainerSettingsRequest, RepoConfig, MountConfig, UserEnvVars } from '../../shared/types';


interface ResolvedEnvConfig {
  cpuLimit?: number;
  memoryLimit?: string;
  dockerEnabled?: boolean;
  environmentJson: EnvironmentJsonPayload;
  capabilitiesJson: CapabilityJsonEntry[];
  instructionsJson: InstructionJsonEntry[];
}

const WORKER_MANAGED_LABEL = 'agentor.managed';
/** The worker's UUID `id` — the only identifying label on a worker container.
 * Everything else (userId, config) lives in the WorkerStore record. */
const WORKER_ID_LABEL = 'agentor.id';

export class ContainerManager {
  /** Keyed by the worker's UUID `id` (stable across rebuild/unarchive). */
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

  /** Build the globally unique Docker container name from the worker's UUID `id`:
   * `<containerPrefix>-<id>`. UUIDs are DNS-label-safe. */
  buildContainerName(id: string): string {
    return `${this.config.containerPrefix}-${id}`;
  }

  /** VS Code tunnel name — must be 3-20 alphanumeric + hyphens. The worker `id`
   * already guarantees global uniqueness; take a userId-prefixed slice so it
   * fits the length cap. */
  private buildTunnelName(userId: string, workerId: string): string {
    const shortId = userId.slice(0, 8);
    return `${shortId}-${workerId}`.slice(0, 20);
  }

  private async resolveUserEnvAndBinds(userId: string): Promise<{ userEnv: UserEnvVars; credentialBinds: string[] }> {
    const userEnv = this.userEnvStore?.getOrDefault(userId) ?? zeroUserEnvVars(userId);
    const credentialBinds: string[] = [];
    if (this.userCredentialManager && userId) {
      await this.userCredentialManager.ensureUserDir(userId);
      credentialBinds.push(...this.userCredentialManager.getBindMountsForUser(userId));
    }
    if (this.storageManager && userId) {
      await this.storageManager.ensureUserSshDir(userId);
      try {
        credentialBinds.push(this.storageManager.getSshAuthorizedKeysBind(userId));
      } catch (err) {
        useLogger().warn(
          `[container] unable to build ssh authorized_keys bind for user ${userId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    return { userEnv, credentialBinds };
  }

  /** Resolve the worker's git identity live from the owning user. The worker
   * references the owner by `userId` only — name/email are never snapshotted onto
   * the worker record, so they always reflect the user's current profile. */
  private resolveGitIdentity(userId: string): { gitName: string; gitEmail: string } {
    const user = getUserById(userId);
    return { gitName: user?.name ?? '', gitEmail: user?.email ?? '' };
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

      // Keyed by the built-in capability's slug, which is its `name` (the id is
      // now a derived UUID). Gated on `builtIn` so a user's custom capability
      // that happens to share the name is never auto-filtered.
      const apiCapabilityFilter: Record<string, keyof ExposeApis> = {
        'port-mapping': 'portMappings',
        'domain-mapping': 'domainMappings',
        'usage': 'usage',
      };
      enabledCapabilities = enabledCapabilities.filter((s) => {
        const apiKey = s.builtIn ? apiCapabilityFilter[s.name] : undefined;
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

    const resolvedId = environmentId || DEFAULT_ENVIRONMENT_ID;
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
      // The worker UUID `id` is the only identifying label; resolve the
      // authoritative record (with userId + config) from the WorkerStore.
      const labelId = labels[WORKER_ID_LABEL] ?? '';
      const worker = labelId ? this.workerStore?.findById(labelId) : undefined;

      const id = worker?.id ?? labelId ?? dc.Id;
      const now = new Date().toISOString();

      this.containers.set(id, {
        id,
        userId: worker?.userId ?? '',
        createdAt: worker?.createdAt ?? now,
        updatedAt: worker?.updatedAt ?? now,
        containerId: dc.Id,
        containerName,
        displayName: worker?.displayName ?? containerName,
        imageName: dc.Image,
        imageId: dc.ImageID,
        status: ContainerManager.STATE_MAP[dc.State] || 'error',
        repos: worker?.repos,
        mounts: worker?.mounts,
        initScript: worker?.initScript,
        environmentId: worker?.environmentId,
        pendingRebuild: worker?.pendingRebuild,
      });
    }

    useLogger().debug(`[container] synced ${this.containers.size} containers`);
  }

  list(): ContainerInfo[] {
    return Array.from(this.containers.values());
  }

  /** Look up a worker by its UUID `id`. */
  get(id: string): ContainerInfo | undefined {
    return this.containers.get(id);
  }

  /** Resolve a worker `id` to its current Docker container id (for dockerode
   * calls). Throws if the worker is unknown. */
  private dockerIdFor(id: string): string {
    const info = this.containers.get(id);
    if (!info) throw new Error('Container not found');
    return info.containerId;
  }

  /** Find an active worker by its globally unique Docker container name. */
  findByContainerName(containerName: string): ContainerInfo | undefined {
    for (const c of this.containers.values()) {
      if (c.containerName === containerName) return c;
    }
    return undefined;
  }

  /** Suggest a friendly display-name slug (e.g. `happy-panda`) for a new worker,
   * avoiding collisions with the user's existing display names where possible.
   * Display names are free-form and not required to be unique — this is only a
   * convenience default for the create form. */
  suggestDisplayName(userId: string): string {
    const taken = new Set<string>();
    for (const c of this.containers.values()) {
      if (c.userId === userId && c.displayName) taken.add(c.displayName.toLowerCase());
    }
    for (const w of this.workerStore?.listForUser(userId) ?? []) {
      if (w.displayName) taken.add(w.displayName.toLowerCase());
    }
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = uniqueNamesGenerator({
        dictionaries: [adjectives, animals],
        separator: '-',
        style: 'lowerCase',
      });
      if (!taken.has(candidate)) return candidate;
    }
    return `worker-${nanoid(6).toLowerCase()}`;
  }

  async create(request: CreateContainerRequest): Promise<ContainerInfo> {
    const userId = request.userId ?? '';
    if (!userId) throw new Error('create: userId is required');

    const envConfig = this.resolveEnvironmentConfig(request.environmentId);

    // The worker's identity is an immutable UUID `id`. The user-facing label is
    // the free-form, editable `displayName` (defaulted to a friendly slug when
    // the user provides none). The Docker container is described by the separate
    // `containerId` (assigned by Docker) and `containerName` (`<prefix>-<id>`).
    const id = randomUUID();
    const displayName = request.displayName?.trim() || this.suggestDisplayName(userId);
    const containerName = this.buildContainerName(id);

    const repos = request.repos?.filter((r) => r.url) || [];

    // Resource limits are an environment property (no per-worker override).
    const cpuLimit = envConfig.cpuLimit ?? this.config.defaultCpuLimit ?? undefined;
    const memoryLimit = envConfig.memoryLimit || this.config.defaultMemoryLimit || undefined;
    const dockerEnabled = envConfig.dockerEnabled ?? true;

    // Git identity resolved live from the owner — never stored on the worker.
    const { gitName, gitEmail } = this.resolveGitIdentity(userId);

    const workerJson: WorkerJsonPayload = {
      id,
      displayName,
      repos,
      initScript: request.initScript?.trim() || '',
      gitName,
      gitEmail,
    };

    const { userEnv, credentialBinds } = await this.resolveUserEnvAndBinds(userId);

    const container = await this.dockerService.createWorkerContainer({
      userId,
      id,
      containerName,
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

    const imageName = this.config.workerImagePrefix + this.config.workerImage;
    const now = new Date().toISOString();

    const mounts = request.mounts?.length ? request.mounts : undefined;
    const initScript = request.initScript?.trim() || undefined;

    const containerInfo: ContainerInfo = {
      id,
      userId,
      createdAt: now,
      updatedAt: now,
      containerId: container.id,
      containerName,
      displayName,
      imageName,
      imageId: '',
      status: 'running',
      repos: repos.length > 0 ? repos : undefined,
      mounts,
      initScript,
      environmentId: request.environmentId,
      pendingRebuild: false,
    };

    this.containers.set(id, containerInfo);

    if (this.workerStore) {
      await this.workerStore.upsert(this.containerInfoToWorkerRecord(containerInfo));
    }

    // Attach log collector to the new container
    useLogCollector().attach(containerName, container.id, 'worker', displayName).catch(() => {});

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
    const info = this.assertRunning(id);
    await this.dockerService.putWorkspaceArchive(info.containerId, tarBuffer);
  }

  async downloadWorkspace(id: string): Promise<NodeJS.ReadableStream> {
    const info = this.assertRunning(id);
    return this.dockerService.getWorkspaceArchive(info.containerId);
  }

  async stop(id: string): Promise<void> {
    const info = this.containers.get(id);
    if (!info) throw new Error('Container not found');
    useLogCollector().detach(info.containerId);
    await this.dockerService.stopContainer(info.containerId);
    info.status = 'stopped';
    info.updatedAt = new Date().toISOString();
    useLogger().info(`[container] stopped ${info.containerName}`);
  }

  async restart(id: string): Promise<void> {
    const info = this.containers.get(id);
    if (!info) throw new Error('Container not found');
    useLogCollector().detach(info.containerId);
    await this.dockerService.restartContainer(info.containerId);
    info.status = 'running';
    info.updatedAt = new Date().toISOString();
    useLogCollector().attach(info.containerName, info.containerId, 'worker', info.displayName).catch(() => {});
    useLogger().info(`[container] restarted ${info.containerName}`);
  }

  private static normRepos(repos: RepoConfig[] | undefined): string {
    return JSON.stringify((repos ?? []).map((r) => ({ provider: r.provider, url: r.url, branch: r.branch || '' })));
  }

  private static normMounts(mounts: MountConfig[] | undefined): string {
    return JSON.stringify((mounts ?? []).map((m) => ({ source: m.source, target: m.target, readOnly: !!m.readOnly })));
  }

  /** Update a worker's editable settings without forcing a recreation.
   *
   * The internal identity (`id`, `containerName`, volumes, routing) is always
   * immutable. Two tiers of settings exist:
   *
   * - **Applied immediately (no rebuild)** — `displayName`. Applied to the
   *   in-memory ContainerInfo and the WorkerStore immediately; the running
   *   worker keeps serving.
   * - **Rebuild-requiring** — `environmentId`, `initScript`, `repos`, `mounts`.
   *   These are baked into the container at create time (the `WORKER`/`ENVIRONMENT`
   *   env JSON and Docker `Binds`), so editing them only updates the stored
   *   desired config and flags the worker `pendingRebuild`. The next `rebuild()`
   *   re-resolves from this stored config and clears the flag.
   *
   * Only the keys present in `patch` are touched. Returns the updated
   * ContainerInfo. */
  async updateSettings(id: string, patch: UpdateContainerSettingsRequest): Promise<ContainerInfo> {
    const info = this.containers.get(id);
    if (!info) throw new Error('Container not found');

    let liveChanged = false;
    let rebuildChanged = false;

    // Validate the new environment UP FRONT — `resolveEnvironmentConfig` is the
    // only operation that can throw (a since-deleted / non-existent environment),
    // and validating before mutating any field keeps `info` untouched on failure.
    // The worker only stores the `environmentId` FK; the config is resolved live
    // at build time, so nothing is snapshotted here. An absent `environmentId`
    // resolves to the built-in `default` environment, so treat `undefined` and the
    // default-env id as the same assignment — otherwise a pure display-name save
    // (which round-trips the form's default-env id) would spuriously flag a rebuild.
    const envChanged = patch.environmentId !== undefined && patch.environmentId !== (info.environmentId || DEFAULT_ENVIRONMENT_ID);
    if (envChanged) this.resolveEnvironmentConfig(patch.environmentId!); // throws → 400 on a bad id

    // Display name — applied immediately (no rebuild).
    if (patch.displayName !== undefined) {
      const next = patch.displayName.trim();
      if (next && next !== info.displayName) {
        info.displayName = next;
        liveChanged = true;
      }
    }

    // Environment assignment — rebuild. Only the FK is stored; the new env's
    // config is applied when the container is next (re)built.
    if (envChanged) {
      info.environmentId = patch.environmentId;
      rebuildChanged = true;
    }

    // Init script — rebuild.
    if (patch.initScript !== undefined) {
      const next = patch.initScript.trim() || undefined;
      if (next !== info.initScript) {
        info.initScript = next;
        rebuildChanged = true;
      }
    }

    // Repositories — rebuild.
    if (patch.repos !== undefined) {
      const cleaned = patch.repos
        .filter((r) => r && r.url)
        .map((r) => ({ provider: r.provider, url: r.url, ...(r.branch ? { branch: r.branch } : {}) }));
      const next = cleaned.length > 0 ? cleaned : undefined;
      if (ContainerManager.normRepos(next) !== ContainerManager.normRepos(info.repos)) {
        info.repos = next;
        rebuildChanged = true;
      }
    }

    // Volume mounts — rebuild.
    if (patch.mounts !== undefined) {
      const cleaned = patch.mounts
        .filter((m) => m && m.source && m.target)
        .map((m) => ({ source: m.source, target: m.target, ...(m.readOnly ? { readOnly: true } : {}) }));
      const next = cleaned.length > 0 ? cleaned : undefined;
      if (ContainerManager.normMounts(next) !== ContainerManager.normMounts(info.mounts)) {
        info.mounts = next;
        rebuildChanged = true;
      }
    }

    if (rebuildChanged) info.pendingRebuild = true;

    if (liveChanged || rebuildChanged) {
      info.updatedAt = new Date().toISOString();
      if (this.workerStore) {
        await this.workerStore.upsert(this.containerInfoToWorkerRecord(info));
      }
      useLogger().info(`[container] updated settings for ${info.containerName}${rebuildChanged ? ' (pending rebuild)' : ''}`);
    }

    return info;
  }

  async remove(id: string): Promise<void> {
    const info = this.containers.get(id);
    if (info) useLogCollector().detach(info.containerId);
    await this.dockerService.removeContainer(info?.containerId ?? id);
    if (info) {
      await cleanupWorkerMappings(info.containerName);
      if (this.storageManager) {
        await this.storageManager.removeWorkerDocker(info.containerName);
        await this.storageManager.removeWorkerWorkspace(info.userId, info.id, info.containerName);
        await this.storageManager.removeWorkerAgents(info.userId, info.id, info.containerName);
      }
      if (this.workerStore) {
        await this.workerStore.delete(info.userId, info.id).catch((err) => {
          useLogger().error(`[container] failed to delete worker record '${info.containerName}': ${err instanceof Error ? err.message : err}`);
        });
      }
      useLogger().info(`[container] removed ${info.containerName}`);
    }
    this.containers.delete(id);
  }

  async archive(id: string): Promise<void> {
    const info = this.containers.get(id);
    if (!info) throw new Error('Container not found');

    useLogCollector().detach(info.containerId);

    if (info.status === 'running') {
      await this.dockerService.stopContainer(info.containerId);
    }

    await this.dockerService.removeContainer(info.containerId);

    if (this.workerStore) {
      await this.workerStore.upsert(this.containerInfoToWorkerRecord(info));
      await this.workerStore.archive(info.userId, info.id);
    }

    useLogger().info(`[container] archived ${info.containerName}`);
    this.containers.delete(id);
  }

  async rebuild(id: string): Promise<ContainerInfo> {
    const info = this.containers.get(id);
    if (!info) throw new Error('Container not found');

    useLogCollector().detach(info.containerId);

    // Stop and remove the old container — workspace, agents, and DinD volumes
    // are preserved (rebuild behaves identically to archive + unarchive).
    if (info.status === 'running') {
      await this.dockerService.stopContainer(info.containerId);
    }
    await this.dockerService.removeContainer(info.containerId);

    this.containers.delete(id);

    // Re-resolve the environment config LIVE from the FK. If the referenced
    // environment was deleted, fall back to the built-in default (the worker no
    // longer carries a config snapshot to fall back to).
    let envConfig: ResolvedEnvConfig;
    try {
      envConfig = this.resolveEnvironmentConfig(info.environmentId);
    } catch {
      envConfig = this.resolveEnvironmentConfig(undefined); // deleted env → default
    }

    const cpuLimit = envConfig.cpuLimit ?? this.config.defaultCpuLimit ?? undefined;
    const memoryLimit = envConfig.memoryLimit || this.config.defaultMemoryLimit || undefined;
    const dockerEnabled = envConfig.dockerEnabled ?? true;

    const { gitName, gitEmail } = this.resolveGitIdentity(info.userId);

    const workerJson: WorkerJsonPayload = {
      id: info.id,
      displayName: info.displayName || '',
      repos: info.repos || [],
      initScript: info.initScript || '',
      gitName,
      gitEmail,
    };

    const { userEnv, credentialBinds } = await this.resolveUserEnvAndBinds(info.userId);

    const container = await this.dockerService.createWorkerContainer({
      userId: info.userId,
      id: info.id,
      containerName: info.containerName,
      cpuLimit,
      memoryLimit,
      mounts: info.mounts,
      dockerEnabled,
      credentialBinds,
      environmentJson: envConfig.environmentJson,
      capabilitiesJson: envConfig.capabilitiesJson,
      instructionsJson: envConfig.instructionsJson,
      workerJson,
      storageManager: this.storageManager,
      userEnv,
    });

    const imageName = this.config.workerImagePrefix + this.config.workerImage;
    const containerInfo: ContainerInfo = {
      id: info.id,
      userId: info.userId,
      createdAt: info.createdAt,
      updatedAt: new Date().toISOString(),
      containerId: container.id,
      containerName: info.containerName,
      displayName: info.displayName,
      imageName,
      imageId: '',
      status: 'running',
      repos: info.repos,
      mounts: info.mounts,
      initScript: info.initScript,
      environmentId: info.environmentId,
      // Rebuild applies any pending settings edits, so the flag is cleared.
      pendingRebuild: false,
    };

    this.containers.set(info.id, containerInfo);

    if (this.workerStore) {
      await this.workerStore.upsert(this.containerInfoToWorkerRecord(containerInfo));
    }

    // Mappings reconcile on Traefik restart — they key by containerName which is unchanged.
    await reassignWorkerMappings(info.containerName);

    useLogCollector().attach(info.containerName, container.id, 'worker', info.displayName).catch(() => {});

    useLogger().info(`[container] rebuilt ${info.containerName} (${container.id.slice(0, 12)})`);

    return containerInfo;
  }

  async unarchive(userId: string, id: string): Promise<ContainerInfo> {
    if (!this.workerStore) throw new Error('WorkerStore not available');

    const worker = this.workerStore.get(userId, id);
    if (!worker || worker.status !== 'archived') {
      throw new Error('Archived worker not found');
    }

    // containerName is derived from the stable UUID `id`, not stored on the record.
    const containerName = this.buildContainerName(worker.id);

    // Re-resolve the environment config LIVE from the FK. If the referenced
    // environment was deleted, fall back to the built-in default.
    let envConfig: ResolvedEnvConfig;
    try {
      envConfig = this.resolveEnvironmentConfig(worker.environmentId);
    } catch {
      envConfig = this.resolveEnvironmentConfig(undefined); // deleted env → default
    }

    const cpuLimit = envConfig.cpuLimit ?? this.config.defaultCpuLimit ?? undefined;
    const memoryLimit = envConfig.memoryLimit || this.config.defaultMemoryLimit || undefined;
    const dockerEnabled = envConfig.dockerEnabled ?? true;

    const { gitName, gitEmail } = this.resolveGitIdentity(worker.userId);

    const workerJson: WorkerJsonPayload = {
      id: worker.id,
      displayName: worker.displayName || '',
      repos: worker.repos || [],
      initScript: worker.initScript || '',
      gitName,
      gitEmail,
    };

    const { userEnv, credentialBinds } = await this.resolveUserEnvAndBinds(worker.userId);

    const container = await this.dockerService.createWorkerContainer({
      userId: worker.userId,
      id: worker.id,
      containerName,
      cpuLimit,
      memoryLimit,
      mounts: worker.mounts,
      dockerEnabled,
      credentialBinds,
      environmentJson: envConfig.environmentJson,
      capabilitiesJson: envConfig.capabilitiesJson,
      instructionsJson: envConfig.instructionsJson,
      workerJson,
      storageManager: this.storageManager,
      userEnv,
    });

    await this.workerStore.unarchive(worker.userId, worker.id);

    const imageName = this.config.workerImagePrefix + this.config.workerImage;
    const containerInfo: ContainerInfo = {
      id: worker.id,
      userId: worker.userId,
      createdAt: worker.createdAt,
      updatedAt: new Date().toISOString(),
      containerId: container.id,
      containerName,
      displayName: worker.displayName,
      imageName,
      imageId: '',
      status: 'running',
      repos: worker.repos,
      mounts: worker.mounts,
      initScript: worker.initScript,
      environmentId: worker.environmentId,
      // Unarchive recreates the container from the stored config, applying any
      // pending settings edits, so the flag is cleared.
      pendingRebuild: false,
    };

    this.containers.set(worker.id, containerInfo);

    await reassignWorkerMappings(containerName);

    useLogCollector().attach(containerName, container.id, 'worker', worker.displayName).catch(() => {});

    useLogger().info(`[container] unarchived ${containerName} (${container.id.slice(0, 12)})`);

    return containerInfo;
  }

  async deleteArchived(userId: string, id: string): Promise<void> {
    if (!this.workerStore) throw new Error('WorkerStore not available');

    const worker = this.workerStore.get(userId, id);
    if (!worker || worker.status !== 'archived') {
      throw new Error('Archived worker not found');
    }

    // containerName is derived from the stable UUID `id`, not stored on the record.
    const containerName = this.buildContainerName(worker.id);

    await cleanupWorkerMappings(containerName);

    if (this.storageManager) {
      await this.storageManager.removeWorkerWorkspace(worker.userId, worker.id, containerName);
      await this.storageManager.removeWorkerDocker(containerName);
      await this.storageManager.removeWorkerAgents(worker.userId, worker.id, containerName);
    }
    await this.workerStore.delete(worker.userId, worker.id);
  }

  listArchived(): WorkerRecord[] {
    return this.workerStore?.listArchived() ?? [];
  }

  async reconcileWorkers(): Promise<void> {
    if (!this.workerStore) return;

    const activeContainerNames = new Set<string>();
    for (const [, info] of this.containers) {
      activeContainerNames.add(info.containerName);
      const existing = this.workerStore.get(info.userId, info.id);
      if (!existing || existing.status === 'active') {
        await this.workerStore.upsert(this.containerInfoToWorkerRecord(info));
      }
    }

    for (const worker of this.workerStore.listActive()) {
      if (!activeContainerNames.has(this.buildContainerName(worker.id))) {
        await this.workerStore.archive(worker.userId, worker.id);
      }
    }
  }

  /** Project the runtime ContainerInfo down to the minimal persisted record —
   * dropping everything Docker can re-discover (containerId, containerName,
   * imageName, imageId) and keeping only the worker's identity + config. */
  private containerInfoToWorkerRecord(info: ContainerInfo): WorkerRecord {
    return {
      id: info.id,
      userId: info.userId,
      createdAt: info.createdAt,
      updatedAt: info.updatedAt,
      displayName: info.displayName,
      status: 'active',
      environmentId: info.environmentId,
      repos: info.repos,
      mounts: info.mounts,
      initScript: info.initScript,
      pendingRebuild: info.pendingRebuild,
    };
  }

  async logs(id: string, tail?: number): Promise<string> {
    return this.dockerService.getLogs(this.dockerIdFor(id), tail);
  }

  async listTmuxWindows(id: string): Promise<TmuxWindow[]> {
    return this.dockerService.execListTmuxWindows(this.dockerIdFor(id));
  }

  async createTmuxWindow(id: string, name?: string): Promise<TmuxWindow> {
    const containerId = this.dockerIdFor(id);
    const windowName = name || `shell-${nanoid(4)}`;
    await this.dockerService.execTmux(containerId, ['new-window', '-t', 'main:', '-n', windowName]);
    const windows = await this.dockerService.execListTmuxWindows(containerId);
    const created = windows.findLast((w) => w.name === windowName);
    if (!created) {
      throw new Error('Failed to find newly created tmux window');
    }
    return created;
  }

  async renameTmuxWindow(id: string, windowIndex: number, newName: string): Promise<void> {
    await this.dockerService.execTmux(this.dockerIdFor(id), ['rename-window', '-t', `main:${windowIndex}`, newName]);
  }

  async killTmuxWindow(id: string, windowIndex: number): Promise<void> {
    if (windowIndex === 0) {
      throw new Error('Cannot kill the main tmux window');
    }
    await this.dockerService.execTmux(this.dockerIdFor(id), ['kill-window', '-t', `main:${windowIndex}`]);
  }

  getServiceStatus(id: string): ServiceStatus {
    const info = this.containers.get(id);
    return {
      running: info?.status === 'running',
      containerId: info?.containerId,
    };
  }

  // --- Generic app instance methods ---

  async listAppInstances(id: string, appTypeId: string): Promise<AppInstanceInfo[]> {
    const info = this.containers.get(id);
    if (!info || info.status !== 'running') return [];
    const instances = await this.dockerService.listAppInstances(info.containerId, appTypeId);

    // Enrich instances with their externally mapped port (if any) so the UI
    // can render SSH connection strings etc. without a second round-trip.
    const appType = getAppType(appTypeId);
    if (appType?.autoPortMapping) {
      for (const inst of instances) {
        const mapping = usePortMappingStore().findByWorkerAndAppType(info.containerName, appTypeId, inst.id);
        if (mapping) inst.externalPort = mapping.externalPort;
      }
    }
    return instances;
  }

  /** AppCreateResult — returned by createAppInstance. `externalPort` is set for
   * apps with `autoPortMapping` (e.g. ssh) so the UI can render the connect
   * string immediately. */
  async createAppInstance(
    id: string,
    appTypeId: string,
  ): Promise<{ id: string; port: number; externalPort?: number }> {
    const info = this.assertRunning(id);

    const appType = getAppType(appTypeId);
    if (!appType) {
      throw new Error(`Unknown app type: ${appTypeId}`);
    }

    const existing = await this.dockerService.listAppInstances(info.containerId, appTypeId);

    if (appType.singleton) {
      const alreadyRunning = existing.find((i) => i.status === 'running' || i.status === 'auth_required');
      if (alreadyRunning) {
        const err = new Error(`${appType.displayName} is already running`) as Error & { statusCode?: number };
        err.statusCode = 409;
        throw err;
      }
    } else if (existing.length >= appType.maxInstances) {
      throw new Error(`Maximum ${appType.displayName} instances reached (${appType.maxInstances})`);
    }

    // Allocate an internal port. Apps without a port range (`ports: []`) use
    // port 0 as a sentinel — this fits the VS Code tunnel app, which talks to
    // Microsoft's relay and does not expose a local listening port.
    let port: number;
    if (appType.fixedInternalPort !== undefined) {
      port = appType.fixedInternalPort;
    } else if (appType.ports.length === 0) {
      port = 0;
    } else {
      const portDef = appType.ports[0]!;
      const usedPorts = new Set(existing.map((i) => i.port));
      let found: number | null = null;
      for (let p = portDef.internalPortStart; p <= portDef.internalPortEnd; p++) {
        if (!usedPorts.has(p)) { found = p; break; }
      }
      if (found === null) throw new Error(`No available ports for ${appType.displayName}`);
      port = found;
    }

    // Allocate an instance id. For singletons the id is fixed to the app type id
    // so restarts reuse the same identifier (and the same port mapping).
    const instanceId = appType.singleton ? appTypeId : `${appTypeId}-${Date.now().toString(36)}`;

    // Compose any app-type-specific extra args for `manage.sh start`.
    const extraArgs: string[] = [];
    if (appTypeId === 'vscode') {
      extraArgs.push(this.buildTunnelName(info.userId, info.id));
    }

    // Auto port mapping — allocate or reuse BEFORE calling manage.sh, so the
    // user sees a consistent mapping even if manage.sh later fails (they can
    // remove it manually if needed).
    let externalPort: number | undefined;
    if (appType.autoPortMapping) {
      externalPort = await this.ensureAutoPortMapping(info, appType, instanceId, port);
    }

    await this.dockerService.startAppInstance(info.containerId, appTypeId, instanceId, port, extraArgs);

    return { id: instanceId, port, ...(externalPort !== undefined ? { externalPort } : {}) };
  }

  private async ensureAutoPortMapping(
    info: ContainerInfo,
    appType: NonNullable<ReturnType<typeof getAppType>>,
    instanceId: string,
    internalPort: number,
  ): Promise<number> {
    const cfg = appType.autoPortMapping!;
    const store = usePortMappingStore();
    const existing = store.findByWorkerAndAppType(info.containerName, appType.id, instanceId);
    if (existing) {
      return existing.externalPort;
    }
    const externalPort = store.findFreeExternalPort(cfg.externalPortStart, cfg.externalPortEnd);
    if (externalPort === null) {
      throw new Error(
        `No available external ports for ${appType.displayName} in ${cfg.externalPortStart}-${cfg.externalPortEnd}`,
      );
    }
    await store.add({
      externalPort,
      type: cfg.type,
      workerId: info.id,
      containerName: info.containerName,
      internalPort,
      appType: appType.id,
      instanceId,
      userId: info.userId,
    });
    try {
      await useTraefikManager().reconcile();
    } catch (err) {
      useLogger().error(
        `[container] traefik reconcile after auto port mapping failed: ${err instanceof Error ? err.message : err}`,
      );
    }
    return externalPort;
  }

  async stopAppInstance(id: string, appTypeId: string, instanceId: string): Promise<void> {
    const info = this.assertRunning(id);
    await this.dockerService.stopAppInstance(info.containerId, appTypeId, instanceId);
  }
}
