defineRouteMeta({
  openAPI: {
    tags: ['Archived Workers'],
    summary: 'Unarchive worker',
    description: 'Restores an archived worker by creating a new container. Admins may unarchive any user\'s worker; regular users only their own.',
    operationId: 'unarchiveWorker',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Worker UUID (internal identity)' },
    ],
    responses: {
      200: { description: 'Restored container info', content: { 'application/json': { schema: { $ref: '#/components/schemas/ContainerInfo' } } } },
      403: { description: 'Not the worker owner', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'Archived worker not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useContainerManager, useWorkerStore } from '../../../utils/services';
import { requireContainerAccess } from '../../../utils/auth-helpers';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  // Resolve the worker globally by id (the admin archived-list returns every
  // user's workers, so an admin must be able to act on any of them) and
  // ownership-check admin-or-owner. The record already knows its owner, so the
  // owning userId is derived from it — no ?userId= query hack.
  const worker = useWorkerStore().findById(id);
  if (!worker || worker.status !== 'archived') {
    throw createError({ statusCode: 404, statusMessage: 'Archived worker not found' });
  }
  requireContainerAccess(event, worker);
  return useContainerManager().unarchive(worker.userId, id);
});
