defineRouteMeta({
  openAPI: {
    tags: ['Archived Workers'],
    summary: 'Delete archived worker',
    description: 'Permanently deletes an archived worker and its workspace volume.',
    operationId: 'deleteArchivedWorker',
    parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' }, description: 'Archived worker name' }],
    responses: {
      200: { description: 'Worker permanently deleted', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
      404: { description: 'Archived worker not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useContainerManager, useWorkerStore } from '../../../utils/services';
import { requireAuth } from '../../../utils/auth-helpers';

export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event);
  const name = getRouterParam(event, 'name')!;
  const worker = useWorkerStore().get(name);
  if (!worker) {
    throw createError({ statusCode: 404, statusMessage: 'Archived worker not found' });
  }
  if (user.role !== 'admin' && worker.userId !== user.id) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }
  await useContainerManager().deleteArchived(name);
  return { ok: true };
});
