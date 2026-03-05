import Docker from 'dockerode';
import { loadConfig } from './config';
import { DockerService } from './docker';
import { ContainerManager } from './container';
import { PortMappingStore } from './port-mapping-store';
import { MapperManager } from './mapper-manager';
import { DomainMappingStore } from './domain-mapping-store';
import { TraefikManager } from './traefik-manager';
import { GitHubService } from './github';
import { EnvironmentStore } from './environments';
import { WorkerStore } from './worker-store';
import { UpdateChecker } from './update-checker';
import { UsageChecker } from './usage-checker';
import { CredentialMountManager } from './credential-mounts';
import { SkillStore } from './skill-store';
import { AgentsMdStore } from './agents-md-store';

function singleton<T>(factory: () => T): () => T {
  let instance: T | undefined;
  return () => {
    if (!instance) instance = factory();
    return instance;
  };
}

export const useConfig = singleton(() => loadConfig());
export const useDockerService = singleton(() => new DockerService(useConfig()));
export const useContainerManager = singleton(() => new ContainerManager(useDockerService(), useConfig()));
export const usePortMappingStore = singleton(() => new PortMappingStore(useConfig().dataDir));
export const useMapperManager = singleton(() => new MapperManager(useConfig(), usePortMappingStore()));
export const useDomainMappingStore = singleton(() => new DomainMappingStore(useConfig().dataDir));
export const useTraefikManager = singleton(() => new TraefikManager(useConfig(), useDomainMappingStore()));
export const useGitHubService = singleton(() => new GitHubService(useConfig()));
export const useEnvironmentStore = singleton(() => new EnvironmentStore(useConfig().dataDir));
export const useWorkerStore = singleton(() => new WorkerStore(useConfig().dataDir));
export const useUpdateChecker = singleton(() => new UpdateChecker(useConfig()));
export const useUsageChecker = singleton(() => new UsageChecker(useConfig()));
export const useCredentialMountManager = singleton(
  () => new CredentialMountManager(new Docker({ socketPath: '/var/run/docker.sock' }))
);
export const useSkillStore = singleton(() => new SkillStore(useConfig().dataDir));
export const useAgentsMdStore = singleton(() => new AgentsMdStore(useConfig().dataDir));

/**
 * Removes all port and domain mappings for a worker and reconciles the
 * mapper/traefik containers if any mappings were removed.
 */
export async function cleanupWorkerMappings(workerId: string): Promise<void> {
  const portRemoved = await usePortMappingStore().removeForWorker(workerId);
  const domainRemoved = await useDomainMappingStore().removeForWorker(workerId);
  if (portRemoved > 0) await useMapperManager().reconcile();
  if (domainRemoved > 0) await useTraefikManager().reconcile();
}
