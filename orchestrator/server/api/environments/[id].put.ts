import { useEnvironmentStore } from '../../utils/services';
import type { NetworkMode } from '../../../shared/types';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  const body = await readBody(event);

  if (body.networkMode) {
    if (!['block', 'block-all', 'package-managers', 'full', 'custom'].includes(body.networkMode)) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid networkMode' });
    }
  }
  if (body.name !== undefined && (!body.name || typeof body.name !== 'string')) {
    throw createError({ statusCode: 400, statusMessage: 'name must be a non-empty string' });
  }

  const update: Partial<Record<string, unknown>> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.cpuLimit !== undefined) update.cpuLimit = body.cpuLimit;
  if (body.memoryLimit !== undefined) update.memoryLimit = body.memoryLimit;
  if (body.networkMode !== undefined) update.networkMode = body.networkMode as NetworkMode;
  if (body.allowedDomains !== undefined) update.allowedDomains = body.allowedDomains;
  if (body.includePackageManagerDomains !== undefined) update.includePackageManagerDomains = body.includePackageManagerDomains;
  if (body.dockerEnabled !== undefined) update.dockerEnabled = body.dockerEnabled;
  if (body.envVars !== undefined) update.envVars = body.envVars;
  if (body.setupScript !== undefined) update.setupScript = body.setupScript;
  if (body.initScript !== undefined) update.initScript = body.initScript;

  const store = useEnvironmentStore();

  try {
    return await store.update(id, update);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('not found')) {
      throw createError({ statusCode: 404, statusMessage: 'Environment not found' });
    }
    throw err;
  }
});
