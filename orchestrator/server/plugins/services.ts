import { useDockerService, useContainerManager, usePortMappingStore, useDomainMappingStore, useTraefikManager, useEnvironmentStore, useWorkerStore, useUpdateChecker, useUsageChecker, useCredentialMountManager, useStorageManager, useCapabilityStore, useInstructionStore, useInitScriptStore, useLogStore, useLogger, useLogCollector } from '../utils/services';
import { loadBuiltInCapabilities, loadBuiltInInstructions, loadBuiltInInitScripts, loadBuiltInEnvironments } from '../utils/built-in-content';
import { useAuth, migrateAuth } from '../utils/auth';

export default defineNitroPlugin(async () => {
  // Initialize logging infrastructure first
  const logStore = useLogStore();
  await logStore.init();
  const logger = useLogger();

  // Attach the log collector to our own container as early as possible so
  // framework/runtime stdout (Nuxt, Nitro, Vite, console.warn outside
  // useLogger, unhandled errors) is captured into orchestrator.log.
  // Intentional useLogger() output buffers in-memory until setReady() below
  // and is written to the same file directly — no duplication because
  // useLogger never prints to stdout.
  const logCollector = useLogCollector();
  await logCollector.attachSelf();

  // Initialize auth (creates SQLite database and tables on first run)
  useAuth();
  await migrateAuth();
  logger.info('[agentor] auth initialized');

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

  // Initialize port mapping store (load from disk) and cleanup stale workers.
  // Mappings survive stop/archive/unarchive/rebuild, so the cleanup set
  // includes BOTH active containers and archived workers (matched by name).
  const portMappingStore = usePortMappingStore();
  await portMappingStore.init();

  const knownWorkerNames = new Set<string>();
  for (const c of containerManager.list()) knownWorkerNames.add(c.name);
  for (const w of workerStore.list()) knownWorkerNames.add(w.name);

  const staleCount = await portMappingStore.cleanupStaleWorkers(knownWorkerNames);
  if (staleCount > 0) {
    logger.info(`[agentor] cleaned up ${staleCount} stale port mapping(s)`);
  }

  // Initialize domain mapping store (load from disk) and cleanup stale workers
  const domainMappingStore = useDomainMappingStore();
  await domainMappingStore.init();

  const staleDomainCount = await domainMappingStore.cleanupStaleWorkers(knownWorkerNames);
  if (staleDomainCount > 0) {
    logger.info(`[agentor] cleaned up ${staleDomainCount} stale domain mapping(s)`);
  }

  // Initialize Traefik manager (reconcile Traefik with persisted port + domain
  // mappings — Traefik handles both, with port mappings as dedicated TCP
  // entrypoints alongside HTTP/HTTPS/TCP routing for domain mappings).
  const traefikManager = useTraefikManager();
  await traefikManager.init();

  // Initialize update checker (polls GHCR for newer images in production mode)
  const updateChecker = useUpdateChecker();
  await updateChecker.init();

  // Initialize usage checker (polls agent usage APIs for OAuth-authenticated agents)
  const usageChecker = useUsageChecker();
  await usageChecker.init();

  logger.info(`[agentor] Synced ${containerManager.list().length} containers, ${workerStore.listArchived().length} archived, ${environmentStore.list().length} environments, ${capabilityStore.list().length} capabilities, ${instructionStore.list().length} instructions, ${initScriptStore.list().length} init scripts, ${portMappingStore.list().length} port mappings, ${domainMappingStore.list().length} domain mappings`);

  // Mark logger as ready (flushes buffered entries) and start collecting
  // logs from worker + traefik containers. Self-attach already ran at the
  // top of this plugin so orchestrator stdout is being captured.
  logger.setReady();
  await logCollector.init();
});
