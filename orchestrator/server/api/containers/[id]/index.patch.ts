defineRouteMeta({
  openAPI: {
    tags: ['Containers'],
    summary: 'Update worker settings',
    description:
      "Updates a worker's editable settings. Every field is optional — only the keys present are changed. `displayName` is applied to the running worker immediately, without a rebuild. `environmentId`, `initScript`, `repos`, and `mounts` are baked into the container at create time, so changing any of them updates the stored config and flags the worker `pendingRebuild: true` until the next rebuild. The internal identity (id, container name, volumes, routing) is always immutable.",
    operationId: 'updateContainerSettings',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Worker container ID' },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              displayName: { type: 'string', description: 'New user-facing display name (free-form, non-empty, ≤100 chars). Live — applied without rebuild.' },
              environmentId: { type: 'string', description: 'Reassign the worker to a different environment. Requires rebuild.' },
              initScript: { type: 'string', description: 'New init script (empty string clears it). Requires rebuild.' },
              repos: { type: 'array', items: { $ref: '#/components/schemas/RepoConfig' }, description: 'Replacement repository list. Requires rebuild.' },
              mounts: { type: 'array', items: { $ref: '#/components/schemas/MountConfig' }, description: 'Replacement host bind-mount list. Requires rebuild.' },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'Updated container info', content: { 'application/json': { schema: { $ref: '#/components/schemas/ContainerInfo' } } } },
      400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      403: { description: 'Not the worker owner', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'Container not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import type { RepoConfig, MountConfig, UpdateContainerSettingsRequest } from '../../../../shared/types';
import { useContainerManager, useEnvironmentStore } from '../../../utils/services';
import { MAX_DISPLAY_NAME_LENGTH } from '../../../utils/validation';
import { requireContainerAccess } from '../../../utils/auth-helpers';

function bad(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message });
}

/** Parse a field that may arrive as a JSON string (multipart/legacy clients) or
 * an already-parsed array. */
function parseArray(value: unknown, label: string): unknown[] {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      bad(`Invalid ${label} JSON`);
    }
  }
  if (!Array.isArray(parsed)) bad(`${label} must be an array`);
  return parsed as unknown[];
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  const body = (await readBody(event)) ?? {};

  const patch: UpdateContainerSettingsRequest = {};

  // --- displayName (live) ---
  if (body.displayName !== undefined && body.displayName !== null) {
    if (typeof body.displayName !== 'string') bad('displayName must be a string');
    const trimmed = body.displayName.trim();
    if (!trimmed) bad('displayName is required');
    if (trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
      bad(`displayName must be at most ${MAX_DISPLAY_NAME_LENGTH} characters`);
    }
    patch.displayName = trimmed;
  }

  // --- environmentId (rebuild) ---
  if (body.environmentId !== undefined && body.environmentId !== null) {
    if (typeof body.environmentId !== 'string' || !body.environmentId.trim()) {
      bad('environmentId must be a non-empty string');
    }
    const env = useEnvironmentStore().getById(body.environmentId);
    if (!env) bad(`Environment not found: ${body.environmentId}`);
    patch.environmentId = body.environmentId;
  }

  // --- initScript (rebuild) ---
  if (body.initScript !== undefined && body.initScript !== null) {
    if (typeof body.initScript !== 'string') bad('initScript must be a string');
    patch.initScript = body.initScript;
  }

  // --- repos (rebuild) ---
  if (body.repos !== undefined && body.repos !== null) {
    const arr = parseArray(body.repos, 'repos');
    const repos: RepoConfig[] = [];
    for (const r of arr) {
      if (typeof r !== 'object' || r === null) bad('each repo must be an object');
      const repo = r as Record<string, unknown>;
      if (repo.url !== undefined && typeof repo.url !== 'string') bad('repo.url must be a string');
      if (repo.provider !== undefined && typeof repo.provider !== 'string') bad('repo.provider must be a string');
      if (repo.branch !== undefined && typeof repo.branch !== 'string') bad('repo.branch must be a string');
      repos.push({
        provider: (repo.provider as string) || 'github',
        url: (repo.url as string) || '',
        ...(repo.branch ? { branch: repo.branch as string } : {}),
      });
    }
    patch.repos = repos;
  }

  // --- mounts (rebuild) ---
  if (body.mounts !== undefined && body.mounts !== null) {
    const arr = parseArray(body.mounts, 'mounts');
    const mounts: MountConfig[] = [];
    for (const m of arr) {
      if (typeof m !== 'object' || m === null) bad('each mount must be an object');
      const mount = m as Record<string, unknown>;
      if (mount.source !== undefined && typeof mount.source !== 'string') bad('mount.source must be a string');
      if (mount.target !== undefined && typeof mount.target !== 'string') bad('mount.target must be a string');
      mounts.push({
        source: (mount.source as string) || '',
        target: (mount.target as string) || '',
        ...(mount.readOnly ? { readOnly: true } : {}),
      });
    }
    patch.mounts = mounts;
  }

  const containerManager = useContainerManager();
  const container = containerManager.get(id);
  if (!container) {
    throw createError({ statusCode: 404, statusMessage: 'Container not found' });
  }

  requireContainerAccess(event, container);

  return containerManager.updateSettings(id, patch);
});
