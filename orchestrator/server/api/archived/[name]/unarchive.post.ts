defineRouteMeta({
  openAPI: {
    tags: ['Archived Workers'],
    summary: 'Unarchive worker',
    description: 'Restores an archived worker by creating a new container with the preserved workspace.',
    operationId: 'unarchiveWorker',
    parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' }, description: 'Archived worker name' }],
    responses: {
      200: { description: 'Restored container info', content: { 'application/json': { schema: { $ref: '#/components/schemas/ContainerInfo' } } } },
      404: { description: 'Archived worker not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useContainerManager } from '../../../utils/services';

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name')!;
  const container = await useContainerManager().unarchive(name);
  return container;
});
