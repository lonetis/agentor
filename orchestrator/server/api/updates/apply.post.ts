import { useUpdateChecker, useMapperManager } from '../../utils/services';

export default defineEventHandler(async () => {
  const checker = useUpdateChecker();
  const status = checker.getStatus();

  if (!status.isProductionMode) {
    throw createError({ statusCode: 400, statusMessage: 'Not in production mode' });
  }

  const hasUpdates = status.orchestrator?.updateAvailable
    || status.mapper?.updateAvailable
    || status.worker?.updateAvailable;

  if (!hasUpdates) {
    throw createError({ statusCode: 400, statusMessage: 'No updates available' });
  }

  const result = await checker.applyUpdates();

  // Force-recreate mapper container with new image if pulled
  if (result.mapperPulled) {
    try {
      await useMapperManager().forceRecreate();
    } catch (err: unknown) {
      result.errors.push(`Mapper recreate failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Schedule orchestrator self-replacement if its image was pulled
  if (result.orchestratorPulled) {
    result.orchestratorRestarting = true;
    setTimeout(async () => {
      try {
        await checker.recreateOrchestrator();
      } catch (err: unknown) {
        console.error(`[update-checker] orchestrator self-replace failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }, 2000);
  }

  // Re-check status after pulls (non-orchestrator images will show as up-to-date)
  if (!result.orchestratorRestarting) {
    await checker.check();
  }

  return result;
});
