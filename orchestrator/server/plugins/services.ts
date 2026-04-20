import { useDockerService, useContainerManager, usePortMappingStore, useDomainMappingStore, useTraefikManager, useEnvironmentStore, useWorkerStore, useUpdateChecker, useUsageChecker, useUserCredentialManager, useUserEnvStore, useOrphanSweeper, useStorageManager, useCapabilityStore, useInstructionStore, useInitScriptStore, useLogStore, useLogger, useLogCollector } from '../utils/services';
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

  // Auth DB + Docker network are independent of each other.
  useAuth();
  const dockerService = useDockerService();
  await Promise.all([migrateAuth(), dockerService.ensureNetwork()]);
  logger.info('[agentor] auth initialized');

  // Storage manager must finish before any store init — stores resolve paths
  // via `<DATA_DIR>/...` and seedBuiltIns writes into `<DATA_DIR>/defaults/`.
  const storageManager = useStorageManager();
  await storageManager.init();
  await storageManager.ensureDefaultsDir();

  const userEnvStore = useUserEnvStore();
  const userCredentialManager = useUserCredentialManager();
  const containerManager = useContainerManager();
  containerManager.setStorageManager(storageManager);
  containerManager.setUserEnvStore(userEnvStore);
  containerManager.setUserCredentialManager(userCredentialManager);

  // All stores load independently; built-in seeding also writes to a separate
  // defaults/ file per store, so we fan them out. `containerManager.sync()` is
  // a Docker API roundtrip and is independent of store state (it only reads
  // workers via optional chaining); it runs in parallel here and
  // `reconcileWorkers()` below re-upserts once the worker store is ready.
  const environmentStore = useEnvironmentStore();
  const capabilityStore = useCapabilityStore();
  const instructionStore = useInstructionStore();
  const initScriptStore = useInitScriptStore();
  const workerStore = useWorkerStore();
  const portMappingStore = usePortMappingStore();
  const domainMappingStore = useDomainMappingStore();

  await Promise.all([
    userEnvStore.init(),
    (async () => {
      await environmentStore.init();
      await environmentStore.seedBuiltIns(await loadBuiltInEnvironments());
    })(),
    (async () => {
      await capabilityStore.init();
      await capabilityStore.seedBuiltIns(await loadBuiltInCapabilities());
    })(),
    (async () => {
      await instructionStore.init();
      await instructionStore.seedBuiltIns(await loadBuiltInInstructions());
    })(),
    (async () => {
      await initScriptStore.init();
      await initScriptStore.seedBuiltIns(await loadBuiltInInitScripts());
    })(),
    workerStore.init(),
    portMappingStore.init(),
    domainMappingStore.init(),
    containerManager.sync(),
  ]);

  containerManager.setEnvironmentStore(environmentStore);
  containerManager.setCapabilityStore(capabilityStore);
  containerManager.setInstructionStore(instructionStore);
  containerManager.setWorkerStore(workerStore);
  await containerManager.reconcileWorkers();

  // Mappings survive stop/archive/unarchive/rebuild, so the cleanup set
  // includes BOTH active containers and archived workers (matched by containerName).
  const knownContainerNames = new Set<string>();
  for (const c of containerManager.list()) knownContainerNames.add(c.containerName);
  for (const w of workerStore.list()) knownContainerNames.add(w.containerName);

  const [staleCount, staleDomainCount] = await Promise.all([
    portMappingStore.cleanupStaleContainers(knownContainerNames),
    domainMappingStore.cleanupStaleContainers(knownContainerNames),
  ]);
  if (staleCount > 0) logger.info(`[agentor] cleaned up ${staleCount} stale port mapping(s)`);
  if (staleDomainCount > 0) logger.info(`[agentor] cleaned up ${staleDomainCount} stale domain mapping(s)`);

  // Traefik reads the mapping stores; init it once they are clean.
  const traefikManager = useTraefikManager();
  await traefikManager.init();

  const updateChecker = useUpdateChecker();
  const usageChecker = useUsageChecker();
  usageChecker.setUserEnvStore(userEnvStore);
  usageChecker.setCredentialManager(userCredentialManager);
  await Promise.all([updateChecker.init(), usageChecker.init()]);

  // Start the orphan sweeper — on a 10-minute interval, prunes per-user
  // data for users that no longer exist in the auth DB. Uses a timer rather
  // than a middleware to avoid ever touching better-auth's request pipeline.
  useOrphanSweeper().start();

  logger.info(`[agentor] Synced ${containerManager.list().length} containers, ${workerStore.listArchived().length} archived, ${environmentStore.list().length} environments, ${capabilityStore.list().length} capabilities, ${instructionStore.list().length} instructions, ${initScriptStore.list().length} init scripts, ${portMappingStore.list().length} port mappings, ${domainMappingStore.list().length} domain mappings`);

  // Mark logger as ready (flushes buffered entries) and start collecting
  // logs from worker + traefik containers. Self-attach already ran at the
  // top of this plugin so orchestrator stdout is being captured.
  logger.setReady();
  await logCollector.init();
});
