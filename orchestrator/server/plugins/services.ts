import { useDockerService, useContainerManager, usePortMappingStore, useMapperManager, useDomainMappingStore, useTraefikManager, useEnvironmentStore, useWorkerStore, useUpdateChecker, useUsageChecker, useCredentialMountManager, useSkillStore, useInstructionStore } from '../utils/services';
import { BUILT_IN_SKILLS, BUILT_IN_INSTRUCTIONS } from '../utils/built-in-content';

export default defineNitroPlugin(async () => {
  const dockerService = useDockerService();
  await dockerService.ensureNetwork();

  // Initialize credential mount manager (resolve host path of /cred bind mount)
  const credentialMountManager = useCredentialMountManager();
  await credentialMountManager.init();

  const containerManager = useContainerManager();
  containerManager.setCredentialMountManager(credentialMountManager);
  await containerManager.sync();

  // Initialize environment store (load from disk) and connect to container manager
  const environmentStore = useEnvironmentStore();
  await environmentStore.init();
  containerManager.setEnvironmentStore(environmentStore);

  // Initialize skill and instruction stores (load from disk, seed built-ins)
  const skillStore = useSkillStore();
  await skillStore.init();
  await skillStore.seedBuiltIns(BUILT_IN_SKILLS);
  containerManager.setSkillStore(skillStore);

  const instructionStore = useInstructionStore();
  await instructionStore.init();
  await instructionStore.seedBuiltIns(BUILT_IN_INSTRUCTIONS);
  containerManager.setInstructionStore(instructionStore);

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
    console.log(`[agentor] cleaned up ${staleCount} stale port mapping(s)`);
  }

  // Initialize mapper manager (reconcile mapper container with persisted mappings)
  const mapperManager = useMapperManager();
  await mapperManager.init();

  // Initialize domain mapping store (load from disk) and cleanup stale workers
  const domainMappingStore = useDomainMappingStore();
  await domainMappingStore.init();

  const staleDomainCount = await domainMappingStore.cleanupStaleWorkers(activeWorkerIds);
  if (staleDomainCount > 0) {
    console.log(`[agentor] cleaned up ${staleDomainCount} stale domain mapping(s)`);
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

  console.log(`[agentor] Synced ${containerManager.list().length} containers, ${workerStore.listArchived().length} archived, ${environmentStore.list().length} environments, ${skillStore.list().length} skills, ${instructionStore.list().length} instructions, ${portMappingStore.list().length} port mappings, ${domainMappingStore.list().length} domain mappings`);
});
