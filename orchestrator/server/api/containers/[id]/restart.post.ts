defineRouteMeta({
  openAPI: {
    tags: ['Containers'],
    summary: 'Restart container',
    description: 'Restarts a worker container.',
    operationId: 'restartContainer',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Container ID' }],
    responses: {
      200: { description: 'Container restarted', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
      404: { description: 'Container not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useContainerManager } from '../../../utils/services';
import { requireContainerAccess } from '../../../utils/auth-helpers';
import { rethrowAsHttpError } from '../../../utils/http-errors';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  try {
    const cm = useContainerManager();
    requireContainerAccess(event, cm.get(id));
    await cm.restart(id);
    return { ok: true };
  } catch (err) {
    rethrowAsHttpError(err);
  }
});
