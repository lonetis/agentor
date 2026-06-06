defineRouteMeta({
  openAPI: {
    tags: ['Archived Workers'],
    summary: 'Delete archived worker',
    description: 'Permanently deletes an archived worker and its volumes. Admins may delete any user\'s worker; regular users only their own.',
    operationId: 'deleteArchivedWorker',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Worker UUID (internal identity)' },
    ],
    responses: {
      200: { description: 'Worker permanently deleted', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
      403: { description: 'Not the worker owner', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'Archived worker not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useContainerManager, useWorkerStore } from '../../../utils/services';
import { requireContainerAccess } from '../../../utils/auth-helpers';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  // Resolve globally by id + ownership-check admin-or-owner (see unarchive).
  const worker = useWorkerStore().findById(id);
  if (!worker || worker.status !== 'archived') {
    throw createError({ statusCode: 404, statusMessage: 'Archived worker not found' });
  }
  requireContainerAccess(event, worker);
  await useContainerManager().deleteArchived(worker.userId, id);
  return { ok: true };
});
