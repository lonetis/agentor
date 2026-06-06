defineRouteMeta({
  openAPI: {
    tags: ['Environments'],
    summary: 'Update environment',
    description: 'Updates an existing environment configuration.',
    operationId: 'updateEnvironment',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Environment ID' }],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Environment' } } },
    },
    responses: {
      200: { description: 'Updated environment', content: { 'application/json': { schema: { $ref: '#/components/schemas/Environment' } } } },
      404: { description: 'Environment not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useEnvironmentStore } from '../../utils/services';
import type { NetworkMode } from '../../../shared/types';
import { requireAuth, canAccessResource } from '../../utils/auth-helpers';

export default defineEventHandler(async (event) => {
  const ctx = requireAuth(event);
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
  if (body.cpuLimit !== undefined && (typeof body.cpuLimit !== 'number' || body.cpuLimit < 0)) {
    throw createError({ statusCode: 400, statusMessage: 'cpuLimit must be a non-negative number (0 = unrestricted)' });
  }
  if (body.enabledCapabilityIds !== undefined && body.enabledCapabilityIds !== null && !Array.isArray(body.enabledCapabilityIds)) {
    throw createError({ statusCode: 400, statusMessage: 'enabledCapabilityIds must be null or an array of ids' });
  }
  if (body.enabledInstructionIds !== undefined && body.enabledInstructionIds !== null && !Array.isArray(body.enabledInstructionIds)) {
    throw createError({ statusCode: 400, statusMessage: 'enabledInstructionIds must be null or an array of ids' });
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
  if (body.exposeApis !== undefined) update.exposeApis = body.exposeApis;
  if (body.enabledCapabilityIds !== undefined) update.enabledCapabilityIds = body.enabledCapabilityIds;
  if (body.enabledInstructionIds !== undefined) update.enabledInstructionIds = body.enabledInstructionIds;

  const store = useEnvironmentStore();

  const existing = store.getById(id);
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Environment not found' });
  }
  if (existing.builtIn) {
    throw createError({ statusCode: 400, statusMessage: 'Cannot modify built-in environments' });
  }
  if (!canAccessResource(ctx, existing, { allowGlobal: false })) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }

  try {
    return await store.update(id, update);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('not found')) {
      throw createError({ statusCode: 404, statusMessage: 'Environment not found' });
    }
    throw err;
  }
});
