import { useDockerService, useContainerManager, usePortMappingStore, useMapperManager, useDomainMappingStore, useTraefikManager, useEnvironmentStore, useWorkerStore, useUpdateChecker, useUsageChecker, useCredentialMountManager, useStorageManager, useCapabilityStore, useInstructionStore, useInitScriptStore, useLogStore, useLogger, useLogCollector } from '../utils/services';
import { loadBuiltInCapabilities, loadBuiltInInstructions, loadBuiltInInitScripts, loadBuiltInEnvironments } from '../utils/built-in-content';

export default defineNitroPlugin(async () => {
  // Initialize logging infrastructure first
  const logStore = useLogStore();
  await logStore.init();
  const logger = useLogger();

  const dockerService = useDockerService();
  await dockerService.ensureNetwork();

  // Initialize storage manager (auto-detect volume vs directory mode from /data mount)
  const storageManager = useStorageManager();
  await storageManager.init();

  // Initialize credential mount manager (resolve host path of /cred bind mount)
  const credentialMountManager = useCredentialMountManager();
  await credentialMountManager.init();

  const containerManager = useContainerManager();
  containerManager.setCredentialMountManager(credentialMountManager);
  containerManager.setStorageManager(storageManager);
  await containerManager.sync();

  // Initialize environment store (load from disk, seed built-ins) and connect to container manager
  const environmentStore = useEnvironmentStore();
  await environmentStore.init();
  await environmentStore.seedBuiltIns(await loadBuiltInEnvironments());
  containerManager.setEnvironmentStore(environmentStore);

  // Initialize capability and instruction stores (load from disk, seed built-ins)
  const capabilityStore = useCapabilityStore();
  await capabilityStore.init();
  await capabilityStore.seedBuiltIns(await loadBuiltInCapabilities());
  containerManager.setCapabilityStore(capabilityStore);

  const instructionStore = useInstructionStore();
  await instructionStore.init();
  await instructionStore.seedBuiltIns(await loadBuiltInInstructions());
  containerManager.setInstructionStore(instructionStore);

  // Initialize init script store (load from disk, seed built-ins)
  const initScriptStore = useInitScriptStore();
  await initScriptStore.init();
  await initScriptStore.seedBuiltIns(await loadBuiltInInitScripts());

  // Initialize worker store (load from disk) and connect to container manager
  const workerStore = useWorkerStore();
  await workerStore.init();
  containerManager.setWorkerStore(workerStore);

  // Reconcile worker store with Docker state (register new containers, archive missing ones)
  await containerManager.reconcileWorkers();

  // Initialize port mapping store (load from disk) and cleanup stale workers
  const portMappingStore = usePortMappingStore();
  await portMappingStore.init();

  const activeWorkerIds = new Set(containerManager.list().map((c) => c.id));
  const staleCount = await portMappingStore.cleanupStaleWorkers(activeWorkerIds);
  if (staleCount > 0) {
    logger.info(`[agentor] cleaned up ${staleCount} stale port mapping(s)`);
  }

  // Initialize mapper manager (reconcile mapper container with persisted mappings)
  const mapperManager = useMapperManager();
  await mapperManager.init();

  // Initialize domain mapping store (load from disk) and cleanup stale workers
  const domainMappingStore = useDomainMappingStore();
  await domainMappingStore.init();

  const staleDomainCount = await domainMappingStore.cleanupStaleWorkers(activeWorkerIds);
  if (staleDomainCount > 0) {
    logger.info(`[agentor] cleaned up ${staleDomainCount} stale domain mapping(s)`);
  }

  // Initialize Traefik manager (reconcile Traefik container with persisted domain mappings)
  const traefikManager = useTraefikManager();
  await traefikManager.init();

  // Initialize update checker (polls GHCR for newer images in production mode)
  const updateChecker = useUpdateChecker();
  await updateChecker.init();

  // Initialize usage checker (polls agent usage APIs for OAuth-authenticated agents)
  const usageChecker = useUsageChecker();
  await usageChecker.init();

  logger.info(`[agentor] Synced ${containerManager.list().length} containers, ${workerStore.listArchived().length} archived, ${environmentStore.list().length} environments, ${capabilityStore.list().length} capabilities, ${instructionStore.list().length} instructions, ${initScriptStore.list().length} init scripts, ${portMappingStore.list().length} port mappings, ${domainMappingStore.list().length} domain mappings`);

  // Mark logger as ready (flushes buffered entries) and start log collector
  logger.setReady();
  const logCollector = useLogCollector();
  await logCollector.init();
});
