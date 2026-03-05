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

export interface TmuxWindow {
  index: number;
  name: string;
  active: boolean;
}

export interface AppInstanceInfo {
  id: string;
  appType: string;
  port: number;
  status: 'running' | 'stopped';
}

export type NetworkMode = 'block-all' | 'block' | 'package-managers' | 'full' | 'custom';

export interface ServiceStatus {
  running: boolean;
  containerId?: string;
}

export type ContainerStatus = 'creating' | 'running' | 'stopped' | 'removing' | 'error';

export interface ContainerInfo {
  id: string;
  name: string;
  displayName?: string;
  repos?: RepoConfig[];
  status: ContainerStatus;
  createdAt: string;
  image: string;
  imageId: string;
  labels: Record<string, string>;
}

export interface CreateContainerRequest {
  name?: string;
  displayName?: string;
  repos?: RepoConfig[];
  cpuLimit?: number;
  memoryLimit?: string;
  mounts?: MountConfig[];
  environmentId?: string;
  initScript?: string;
}

export interface ImageUpdateInfo {
  name: string;
  localDigest: string;
  remoteDigest: string;
  updateAvailable: boolean;
  lastChecked: string;
  error?: string;
}

export type UpdatableImage = 'orchestrator' | 'mapper' | 'worker' | 'traefik';

export interface UpdateStatus {
  orchestrator: ImageUpdateInfo | null;
  mapper: ImageUpdateInfo | null;
  worker: ImageUpdateInfo | null;
  traefik: ImageUpdateInfo | null;
  isProductionMode: boolean;
}

export interface ApplyResult {
  orchestratorPulled: boolean;
  mapperPulled: boolean;
  workerPulled: boolean;
  traefikPulled: boolean;
  orchestratorRestarting: boolean;
  errors: string[];
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
}

export interface AgentUsageStatus {
  agents: AgentUsageInfo[];
}

export interface ExposeApis {
  portMappings: boolean;
  domainMappings: boolean;
  usage: boolean;
}

export interface SkillInfo {
  id: string;
  name: string;
  content: string;
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentsMdEntryInfo {
  id: string;
  name: string;
  content: string;
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
}
