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
  ImageUpdateInfo,
  UpdatableImage,
  UpdateStatus,
  ApplyResult,
  PruneResult,
  AgentAuthType,
  UsageWindow,
  AgentUsageInfo,
  AgentUsageStatus,
  ExposeApis,
  CapabilityInfo,
  InstructionInfo,
  CredentialInfo,
  InitScriptInfo,
  VsCodeTunnelStatus,
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
}

export interface PortMapping {
  externalPort: number;
  type: 'localhost' | 'external';
  /** Per-user worker name. */
  workerName: string;
  /** Globally unique Docker container name. */
  containerName: string;
  internalPort: number;
  appType?: string;
  instanceId?: string;
}

export interface DomainMapping {
  id: string;
  subdomain: string;
  baseDomain: string;
  path: string;
  protocol: 'http' | 'https' | 'tcp';
  /** When true, also matches any single-label prefix (e.g. `*.sub.domain.com`). */
  wildcard: boolean;
  /** Per-user worker name. */
  workerName: string;
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

export interface OrchestratorEnvVar {
  name: string;
  configured: boolean;
}

export interface ArchivedWorker {
  id: string;
  name: string;
  displayName?: string;
  environmentId?: string;
  environmentName?: string;
  createdAt: string;
  archivedAt?: string;
  repos?: RepoConfig[];
  mounts?: MountConfig[];
  initScript?: string;
  cpuLimit?: number;
  memoryLimit?: string;
  networkMode?: string;
  dockerEnabled?: boolean;
  allowedDomains?: string[];
  includePackageManagerDomains?: boolean;
  setupScript?: string;
  envVars?: string;
  exposeApis?: ExposeApisType;
  capabilityNames?: string[];
  instructionNames?: string[];
  image: string;
}

export type TabType = 'terminal' | 'desktop' | 'apps' | 'editor' | 'vscode' | 'logs';

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
