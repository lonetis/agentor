defineRouteMeta({
  openAPI: {
    tags: ['Updates'],
    summary: 'Apply updates',
    description: 'Pulls updated images and recreates affected containers. Optionally targets specific images.',
    operationId: 'applyUpdates',
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              images: { type: 'array', items: { type: 'string', enum: ['orchestrator', 'mapper', 'worker', 'traefik'] }, description: 'Specific images to update (all if omitted)' },
            },
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Apply result',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                orchestratorPulled: { type: 'boolean' },
                mapperPulled: { type: 'boolean' },
                workerPulled: { type: 'boolean' },
                traefikPulled: { type: 'boolean' },
                orchestratorRestarting: { type: 'boolean' },
                errors: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
    },
  },
});

import type { UpdatableImage } from '../../../shared/types';
import { useUpdateChecker, useMapperManager, useTraefikManager } from '../../utils/services';

export default defineEventHandler(async (event) => {
  const checker = useUpdateChecker();
  const status = checker.getStatus();

  if (!status.isProductionMode) {
    throw createError({ statusCode: 400, statusMessage: 'Not in production mode' });
  }

  const body = await readBody<{ images?: UpdatableImage[] }>(event).catch(() => null);
  const images = body?.images;

  const hasUpdates = status.orchestrator?.updateAvailable
    || status.mapper?.updateAvailable
    || status.worker?.updateAvailable
    || status.traefik?.updateAvailable;

  if (!hasUpdates) {
    throw createError({ statusCode: 400, statusMessage: 'No updates available' });
  }

  const result = await checker.applyUpdates(images);

  // Force-recreate mapper container with new image if pulled
  if (result.mapperPulled) {
    try {
      await useMapperManager().forceRecreate();
    } catch (err: unknown) {
      result.errors.push(`Mapper recreate failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Force-recreate Traefik container with new image if pulled
  if (result.traefikPulled) {
    try {
      await useTraefikManager().forceRecreate();
    } catch (err: unknown) {
      result.errors.push(`Traefik recreate failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Schedule orchestrator self-replacement if its image was pulled
  if (result.orchestratorPulled) {
    result.orchestratorRestarting = true;
    setTimeout(async () => {
      try {
        await checker.recreateOrchestrator();
      } catch (err: unknown) {
        useLogger().error(`[update-checker] orchestrator self-replace failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }, 2000);
  }

  // Re-check status after pulls (non-orchestrator images will show as up-to-date)
  if (!result.orchestratorRestarting) {
    await checker.check();
  }

  return result;
});
