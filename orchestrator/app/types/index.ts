import type { NetworkMode, RepoConfig, MountConfig, ExposeApis as ExposeApisType } from '../../shared/types';

export type {
  RepoConfig,
  MountConfig,
  TmuxWindow,
  AppInstanceInfo,
  NetworkMode,
  ServiceStatus,
  ContainerInfo,
  ContainerStatus,
  CreateContainerRequest,
  UpdateContainerSettingsRequest,
  ImageUpdateInfo,
  UpdatableImage,
  UpdateStatus,
  ApplyResult,
  PruneResult,
  AgentAuthType,
  UsageWindow,
  AgentUsageInfo,
  AgentUsageStatus,
  WorkerMetrics,
  WorkerMetricsStatus,
  ExposeApis,
  CapabilityInfo,
  InstructionInfo,
  CredentialInfo,
  InitScriptInfo,
  LogLevel,
  LogSource,
  LogEntry,
} from '../../shared/types';

export interface GitProviderInfo {
  id: string;
  displayName: string;
  placeholder: string;
  tokenConfigured: boolean;
}

export interface GitHubRepoInfo {
  fullName: string;
  private: boolean;
  defaultBranch: string;
}

export interface GitHubBranchInfo {
  name: string;
}

export interface AppTypeInfo {
  id: string;
  displayName: string;
  description: string;
  ports: { id: string; name: string }[];
  maxInstances: number;
  singleton?: boolean;
  fixedInternalPort?: number;
  autoPortMapping?: {
    type: 'external' | 'localhost';
    externalPortStart: number;
    externalPortEnd: number;
  };
}

export interface PortMapping {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  externalPort: number;
  type: 'localhost' | 'external';
  /** The owning worker's UUID `id`. */
  workerId: string;
  /** Globally unique Docker container name. */
  containerName: string;
  internalPort: number;
  appType?: string;
  instanceId?: string;
}

export interface DomainMapping {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  subdomain: string;
  baseDomain: string;
  path: string;
  protocol: 'http' | 'https' | 'tcp';
  /** When true, also matches any single-label prefix (e.g. `*.sub.domain.com`). */
  wildcard: boolean;
  /** The owning worker's UUID `id`. */
  workerId: string;
  /** Globally unique Docker container name. */
  containerName: string;
  internalPort: number;
  basicAuth?: {
    username: string;
    password: string;
  };
}

export type ChallengeType = 'none' | 'http' | 'dns' | 'selfsigned';

export interface BaseDomainConfig {
  domain: string;
  challengeType: ChallengeType;
  dnsProvider?: string;
}

export interface DomainMapperStatus {
  enabled: boolean;
  baseDomains: string[];
  baseDomainConfigs: BaseDomainConfig[];
  totalMappings: number;
  hasSelfSignedCa?: boolean;
  dashboardUrl?: string;
}

export interface EnvironmentInfo {
  id: string;
  name: string;
  cpuLimit: number;
  memoryLimit: string;
  networkMode: NetworkMode;
  allowedDomains: string[];
  includePackageManagerDomains: boolean;
  dockerEnabled: boolean;
  envVars: string;
  setupScript: string;
  exposeApis: ExposeApisType;
  enabledCapabilityIds: string[] | null;
  enabledInstructionIds: string[] | null;
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A system environment variable the orchestrator/entrypoint injects into every
 * worker (from `GET /api/worker-env-vars`). Always present and non-secret, so it
 * carries a human-readable description instead of a configured/not-set flag. */
export interface WorkerSystemEnvVar {
  name: string;
  description: string;
}

/** Mirrors the server's slim `WorkerRecord`. Fields describing the live Docker
 * container (containerId, containerName, imageName, imageId) are NOT persisted —
 * they are discovered at runtime and only appear on `ContainerInfo`. */
export interface ArchivedWorker {
  /** Worker UUID `id` — used to unarchive / delete. */
  id: string;
  userId: string;
  displayName: string;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  // Normalized: only the environment FK is stored; env config + git identity are
  // resolved live at build time, never snapshotted onto the worker.
  environmentId?: string;
  repos?: RepoConfig[];
  mounts?: MountConfig[];
  initScript?: string;
}

export type TabType = 'terminal' | 'desktop' | 'apps' | 'editor' | 'logs';

export interface Tab {
  id: string;
  containerId: string;
  containerName: string;
  type: TabType;
}

export type SplitDirection = 'horizontal' | 'vertical';

export interface PaneLeafNode {
  id: string;
  sizeFraction: number;
  tabs: Tab[];
  activeTabId: string | null;
}

export interface PaneContainerNode {
  id: string;
  sizeFraction: number;
  direction: SplitDirection;
  children: PaneNode[];
}

export type PaneNode = PaneLeafNode | PaneContainerNode;

export interface DragPayload {
  tabId: string;
  sourceNodeId: string;
}

export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center';
