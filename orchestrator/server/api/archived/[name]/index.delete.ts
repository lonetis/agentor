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

import { useContainerManager } from '../../../utils/services';

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name')!;
  await useContainerManager().deleteArchived(name);
  return { ok: true };
});
