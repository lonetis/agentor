import type { NetworkMode, RepoConfig } from '../../shared/types';

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

export interface InitPresetInfo {
  id: string;
  displayName: string;
  script: string;
  apiDomains: string[];
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
  workerId: string;
  workerName: string;
  internalPort: number;
  appType?: string;
  instanceId?: string;
}

export interface DomainMapping {
  id: string;
  subdomain: string;
  baseDomain: string;
  protocol: 'http' | 'https' | 'tcp';
  workerId: string;
  workerName: string;
  internalPort: number;
  basicAuth?: {
    username: string;
    password: string;
  };
}

export interface DomainMapperStatus {
  enabled: boolean;
  baseDomains: string[];
  totalMappings: number;
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
  initScript: string;
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
  cpuLimit?: number;
  memoryLimit?: string;
  networkMode?: string;
  dockerEnabled?: boolean;
  image: string;
  labels: Record<string, string>;
}

export type TabType = 'terminal' | 'desktop' | 'apps' | 'editor';

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
