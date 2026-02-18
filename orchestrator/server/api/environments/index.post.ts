import { useEnvironmentStore } from '../../utils/services';
import type { NetworkMode } from '../../../shared/types';

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (!body.name || typeof body.name !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'name is required' });
  }

  const networkMode: NetworkMode = body.networkMode || 'full';
  if (!['block', 'block-all', 'package-managers', 'full', 'custom'].includes(networkMode)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid networkMode' });
  }

  const store = useEnvironmentStore();
  const env = await store.create({
    name: body.name,
    cpuLimit: typeof body.cpuLimit === 'number' ? body.cpuLimit : 0,
    memoryLimit: body.memoryLimit || '',
    networkMode,
    allowedDomains: Array.isArray(body.allowedDomains) ? body.allowedDomains : [],
    includePackageManagerDomains: !!body.includePackageManagerDomains,
    dockerEnabled: body.dockerEnabled ?? true,
    envVars: body.envVars || '',
    setupScript: body.setupScript || '',
    initScript: body.initScript || '',
  });

  setResponseStatus(event, 201);
  return env;
});
