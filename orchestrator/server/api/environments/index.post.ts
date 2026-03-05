defineRouteMeta({
  openAPI: {
    tags: ['Environments'],
    summary: 'Create environment',
    description: 'Creates a new worker environment configuration.',
    operationId: 'createEnvironment',
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Environment' } } },
    },
    responses: {
      201: { description: 'Created environment', content: { 'application/json': { schema: { $ref: '#/components/schemas/Environment' } } } },
      400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

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
    exposeApis: body.exposeApis ?? { portMappings: true, domainMappings: true, usage: true },
    enabledSkillIds: body.enabledSkillIds ?? null,
    enabledAgentsMdIds: body.enabledAgentsMdIds ?? null,
  });

  setResponseStatus(event, 201);
  return env;
});
