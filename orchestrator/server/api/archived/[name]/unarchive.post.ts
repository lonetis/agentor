defineRouteMeta({
  openAPI: {
    tags: ['Archived Workers'],
    summary: 'Unarchive worker',
    description: 'Restores the caller\'s archived worker by creating a new container. Admins may pass `?userId=` to target another user\'s archived worker.',
    operationId: 'unarchiveWorker',
    parameters: [
      { name: 'name', in: 'path', required: true, schema: { type: 'string' }, description: 'Per-user worker name' },
      { name: 'userId', in: 'query', required: false, schema: { type: 'string' }, description: 'Admin-only — act on this user\'s worker' },
    ],
    responses: {
      200: { description: 'Restored container info', content: { 'application/json': { schema: { $ref: '#/components/schemas/ContainerInfo' } } } },
      404: { description: 'Archived worker not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useContainerManager, useWorkerStore } from '../../../utils/services';
import { requireAuth } from '../../../utils/auth-helpers';

export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event);
  const name = getRouterParam(event, 'name')!;
  const query = getQuery(event);
  const targetUserId = typeof query.userId === 'string' && user.role === 'admin' ? query.userId : user.id;
  const worker = useWorkerStore().get(targetUserId, name);
  if (!worker || worker.status !== 'archived') {
    throw createError({ statusCode: 404, statusMessage: 'Archived worker not found' });
  }
  const container = await useContainerManager().unarchive(targetUserId, name);
  return container;
});
