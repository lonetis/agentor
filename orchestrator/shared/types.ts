export interface RepoConfig {
  provider: string;
  url: string;
  branch?: string;
}

export interface MountConfig {
  source: string;
  target: string;
  readOnly?: boolean;
}

/**
 * Common shape shared by every persisted resource. Resources extend this (and
 * usually `UserOwnedResource`) and add their own fields — keeping the model
 * extensible: new optional fields can be added in a later release without
 * touching the base. `id` is always a UUID v4 minted server-side.
 */
export interface BaseResource {
  /** UUID v4 — the stable, immutable identity of the resource. */
  id: string;
  /** ISO 8601 timestamp of first creation. */
  createdAt: string;
  /** ISO 8601 timestamp of the last mutation. */
  updatedAt: string;
}

/** A resource owned by a user. `userId` is `null` only for platform-seeded
 * built-in entries (see `builtIn`). */
export interface UserOwnedResource extends BaseResource {
  userId: string;
}

export interface TmuxWindow {
  index: number;
  name: string;
  active: boolean;
}

export interface AppInstanceInfo {
  id: string;
  appType: string;
  /** Internal container port the app is listening on. `0` when the app does not expose a port (e.g. vscode tunnel). */
  port: number;
  status: 'running' | 'stopped' | 'auth_required';
  /** Externally reachable port from the auto-created port mapping, if any (e.g. ssh). */
  externalPort?: number;
  /** VS Code tunnel machine name once the tunnel has connected. */
  machineName?: string;
  /** Device-code auth URL (VS Code tunnel) while the app is in `auth_required`. */
  authUrl?: string;
  /** Device-code auth code (VS Code tunnel) while the app is in `auth_required`. */
  authCode?: string;
}

export type NetworkMode = 'block-all' | 'block' | 'package-managers' | 'full' | 'custom';

export interface ServiceStatus {
  running: boolean;
  containerId?: string;
}

export type ContainerStatus = 'creating' | 'running' | 'stopped' | 'removing' | 'error';

/** A worker. `id` is the worker's stable UUID identity (immutable across
 * rebuild/unarchive); `containerId`/`containerName` describe the current Docker
 * container (the `containerId` changes on every rebuild). Extends
 * `UserOwnedResource` so it carries `id`/`userId`/`createdAt`/`updatedAt`. */
export interface ContainerInfo extends UserOwnedResource {
  /** Current Docker container ID (64-hex; the short form is the in-container
   * hostname). Changes on every rebuild/unarchive — never use it as the worker's
   * identity (use `id`). */
  containerId: string;
  /** Globally unique Docker container name — `<containerPrefix>-<id>`. The stable
   * DNS identifier Traefik routes to and the prefix for per-worker volume names. */
  containerName: string;
  /** Editable, user-facing label shown throughout the dashboard. Free-form (may
   * contain spaces/mixed case, need not be unique). Defaults to a friendly
   * generated slug when the user provides none. Renameable without recreating
   * the container — see `PATCH /api/containers/:id`. */
  displayName: string;
  /** Worker image reference (e.g. `agentor-worker:latest`). */
  imageName: string;
  imageId: string;
  status: ContainerStatus;
  repos?: RepoConfig[];
  mounts?: MountConfig[];
  initScript?: string;
  /** Foreign key to the assigned environment. The environment's own config (CPU /
   * memory / network / docker / setup script / env vars / exposed APIs /
   * capabilities / instructions) is NOT copied onto the worker — it is resolved
   * live from the EnvironmentStore by this id when the container is built. The
   * git identity is likewise resolved live from the owning `userId`. */
  environmentId?: string;
  /** True when the worker's stored config carries rebuild-requiring edits
   * (environment, repos, mounts, or init script) that have not yet been applied
   * to the running container. Live edits (display name) never set this. Cleared
   * whenever the container is (re)created — create, rebuild, or unarchive. */
  pendingRebuild?: boolean;
}

export interface CreateContainerRequest {
  /** Editable, user-facing label. Free-form; defaults to a generated friendly
   * slug server-side when omitted. The internal worker identity is a UUID v4
   * minted by the orchestrator and is never client-supplied. */
  displayName?: string;
  repos?: RepoConfig[];
  mounts?: MountConfig[];
  /** Foreign key to the environment whose config (incl. CPU/memory limits) the
   * worker is built with. Resource limits are an environment property — there is
   * no per-worker limit override. */
  environmentId?: string;
  initScript?: string;
  /** Populated server-side from the authenticated session — never sent by clients.
   * The owner; the worker's git identity is resolved live from this user. */
  userId?: string;
}

/** Partial worker-settings update accepted by `PATCH /api/containers/:id`. Every
 * field is optional — only the keys present are changed. `displayName` is a live
 * edit (applied to the running worker immediately); `environmentId`, `initScript`,
 * `repos`, and `mounts` are baked into the container at create time, so changing
 * any of them flags the worker `pendingRebuild` until the next rebuild. */
export interface UpdateContainerSettingsRequest {
  displayName?: string;
  environmentId?: string;
  initScript?: string;
  repos?: RepoConfig[];
  mounts?: MountConfig[];
}

export interface ImageUpdateInfo {
  name: string;
  localDigest: string;
  remoteDigest: string;
  updateAvailable: boolean;
  lastChecked: string;
  error?: string;
}

export type UpdatableImage = 'orchestrator' | 'worker' | 'traefik';

export interface UpdateStatus {
  orchestrator: ImageUpdateInfo | null;
  worker: ImageUpdateInfo | null;
  traefik: ImageUpdateInfo | null;
  isProductionMode: boolean;
}

export interface ApplyResult {
  orchestratorPulled: boolean;
  workerPulled: boolean;
  traefikPulled: boolean;
  orchestratorRestarting: boolean;
  errors: string[];
}

export interface PruneResult {
  imagesDeleted: number;
  spaceReclaimed: number;
}

export type AgentAuthType = 'oauth' | 'api-key' | 'none';

export interface UsageWindow {
  label: string;
  utilization: number;
  resetsAt: string | null;
}

export interface AgentUsageInfo {
  agentId: string;
  displayName: string;
  authType: AgentAuthType;
  usageAvailable: boolean;
  windows: UsageWindow[];
  planType?: string;
  error?: string;
  lastChecked?: string;
  lastFetchTime?: string;
}

export interface AgentUsageStatus {
  agents: AgentUsageInfo[];
}

export interface ExposeApis {
  portMappings: boolean;
  domainMappings: boolean;
  usage: boolean;
}

/** A reusable capability document. Built-in entries carry `userId: null` and
 * `builtIn: true`; user entries carry their owner's id and `builtIn: false`. */
export interface CapabilityInfo {
  id: string;
  name: string;
  content: string;
  builtIn: boolean;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InstructionInfo {
  id: string;
  name: string;
  content: string;
  builtIn: boolean;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialInfo {
  agentId: string;
  fileName: string;
  configured: boolean;
}

/** A single env var the user wants injected into every worker they own, keyed by
 * the actual env var NAME (e.g. `GITHUB_TOKEN`). Predefined and custom env vars
 * are stored uniformly — the predefined/custom split is purely a UI convenience. */
export interface UserEnvVar {
  key: string;
  value: string;
}

export interface UserEnvVars {
  userId: string;
  createdAt: string;
  updatedAt: string;
  /** All env vars (predefined + custom alike), keyed by env var name. */
  envVars: UserEnvVar[];
}

export type UserEnvVarsInput = { envVars?: UserEnvVar[] };

/** Well-known env var names the Account UI surfaces with dedicated inputs (in
 * order). Storage treats them identically to any other env var — this list is
 * only a UI affordance and is trivially extensible by adding a key. */
export const PREDEFINED_ENV_VAR_KEYS = [
  'GITHUB_TOKEN',
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
] as const;

/** The user's SSH public key(s) — NOT an env var. Stored only in
 * `<DATA_DIR>/users/<userId>/ssh/authorized_keys` (1:1 with the Account UI field)
 * and bind-mounted read-only into every worker the user owns. */
export interface UserSshKey {
  sshPublicKey: string;
}

export interface InitScriptInfo {
  id: string;
  name: string;
  content: string;
  builtIn: boolean;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogSource = 'orchestrator' | 'worker' | 'traefik';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  source: LogSource;
  sourceId?: string;
  sourceName?: string;
  message: string;
}
