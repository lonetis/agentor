defineRouteMeta({
  openAPI: {
    tags: ['Containers'],
    summary: 'Import a worker',
    description:
      'Restores a worker from an export bundle as a brand-new worker (fresh UUID). The request body is the raw `.tar` bundle produced by the export endpoint (Content-Type `application/x-tar`). Recreates the environment, restores the workspace + agent-data volumes, imports any captured filesystem into a per-worker image, and recreates port/domain mappings (skipping conflicts). Pass `?displayName=` to override the restored worker\'s label.',
    operationId: 'importWorker',
    parameters: [
      { name: 'displayName', in: 'query', required: false, schema: { type: 'string' }, description: 'Display name for the restored worker' },
    ],
    requestBody: {
      required: true,
      content: { 'application/x-tar': { schema: { type: 'string', format: 'binary' } } },
    },
    responses: {
      201: { description: 'Imported worker', content: { 'application/json': { schema: { $ref: '#/components/schemas/ContainerInfo' } } } },
      400: { description: 'Invalid bundle' },
      401: { description: 'Unauthorized' },
    },
  },
});

import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { useContainerManager, useConfig } from '../../utils/services';
import { requireAuth } from '../../utils/auth-helpers';

export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event);
  const q = getQuery(event);
  const displayName = typeof q.displayName === 'string' ? q.displayName : undefined;

  const tmpDir = join(useConfig().dataDir, 'tmp', `import-upload-${randomUUID()}`);
  await mkdir(tmpDir, { recursive: true });
  const bundlePath = join(tmpDir, 'bundle.tar');

  try {
    // Stream the upload straight to disk — bundles can be multi-GB (rootfs).
    await pipeline(event.node.req, createWriteStream(bundlePath));
    const info = await useContainerManager().importWorker(user.id, bundlePath, { displayName });
    setResponseStatus(event, 201);
    return info;
  } catch (err) {
    throw createError({ statusCode: 400, statusMessage: err instanceof Error ? err.message : 'Worker import failed' });
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});
