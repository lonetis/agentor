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
import { CapabilityStore } from './capability-store';
import { InstructionStore } from './instruction-store';
import { InitScriptStore } from './init-script-store';
import { StorageManager } from './storage';
import { SelfSignedCertManager } from './selfsigned-certs';
import { LogStore } from './log-store';
import { LogBroadcaster } from './log-broadcaster';
import { Logger } from './logger';
import { LogCollector } from './log-collector';

function singleton<T>(factory: () => T): () => T {
  let instance: T | undefined;
  return () => {
    if (!instance) instance = factory();
    return instance;
  };
}

export const useConfig = singleton(() => loadConfig());
export const useDockerService = singleton(() => new DockerService(useConfig()));
export const useStorageManager = singleton(
  () => new StorageManager(new Docker({ socketPath: '/var/run/docker.sock' }), useConfig())
);
export const useContainerManager = singleton(() => new ContainerManager(useDockerService(), useConfig()));
export const usePortMappingStore = singleton(() => new PortMappingStore(useConfig().dataDir));
export const useMapperManager = singleton(() => new MapperManager(useConfig(), usePortMappingStore(), useStorageManager()));
export const useDomainMappingStore = singleton(() => new DomainMappingStore(useConfig().dataDir));
export const useSelfSignedCertManager = singleton(() => new SelfSignedCertManager(useConfig().dataDir));
export const useTraefikManager = singleton(() => new TraefikManager(useConfig(), useDomainMappingStore(), useStorageManager(), useSelfSignedCertManager()));
export const useGitHubService = singleton(() => new GitHubService(useConfig()));
export const useEnvironmentStore = singleton(() => new EnvironmentStore(useConfig().dataDir));
export const useWorkerStore = singleton(() => new WorkerStore(useConfig().dataDir));
export const useUpdateChecker = singleton(() => new UpdateChecker(useConfig()));
export const useUsageChecker = singleton(() => new UsageChecker(useConfig()));
export const useCredentialMountManager = singleton(
  () => new CredentialMountManager(new Docker({ socketPath: '/var/run/docker.sock' }))
);
export const useCapabilityStore = singleton(() => new CapabilityStore(useConfig().dataDir));
export const useInstructionStore = singleton(() => new InstructionStore(useConfig().dataDir));
export const useInitScriptStore = singleton(() => new InitScriptStore(useConfig().dataDir));
export const useLogStore = singleton(() => new LogStore(useConfig()));
export const useLogBroadcaster = singleton(() => new LogBroadcaster());
export const useLogger = singleton(() => new Logger(useConfig(), useLogStore(), useLogBroadcaster()));
export const useLogCollector = singleton(() => new LogCollector(useConfig(), useLogStore(), useLogBroadcaster()));

/**
 * Removes all port and domain mappings for a worker (by name) and reconciles
 * the mapper/traefik containers if any mappings were removed. Called when a
 * worker is permanently deleted — mappings are preserved across stop, archive,
 * unarchive, and rebuild.
 */
export async function cleanupWorkerMappings(workerName: string): Promise<void> {
  const portRemoved = await usePortMappingStore().removeForWorkerName(workerName);
  const domainRemoved = await useDomainMappingStore().removeForWorkerName(workerName);
  if (portRemoved > 0) await useMapperManager().reconcile();
  if (domainRemoved > 0) await useTraefikManager().reconcile();
}

/**
 * Updates the workerId field of all mappings for a worker to the new container
 * ID (used after rebuild/unarchive since the Docker container ID changes). The
 * mapper and Traefik both route by workerName via Docker DNS, so fresh lookups
 * pick up the new container automatically — we only need to reconcile() so the
 * mapper container is ensured running (idempotent when bindings match).
 */
export async function reassignWorkerMappings(workerName: string, newContainerId: string): Promise<void> {
  const portChanged = await usePortMappingStore().reassignWorkerContainer(workerName, newContainerId);
  const domainChanged = await useDomainMappingStore().reassignWorkerContainer(workerName, newContainerId);
  if (portChanged > 0) await useMapperManager().reconcile();
  if (domainChanged > 0) await useTraefikManager().reconcile();
}
