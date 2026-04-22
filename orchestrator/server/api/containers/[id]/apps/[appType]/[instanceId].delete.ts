defineRouteMeta({
  openAPI: {
    tags: ['Apps'],
    summary: 'Stop app instance',
    description: 'Stops a running app instance in a container.',
    operationId: 'stopAppInstance',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Container ID' },
      { name: 'appType', in: 'path', required: true, schema: { type: 'string' }, description: 'App type' },
      { name: 'instanceId', in: 'path', required: true, schema: { type: 'string' }, description: 'Instance ID to stop' },
    ],
    responses: {
      200: { description: 'App stopped', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
      404: { description: 'Instance not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useContainerManager } from '../../../../../utils/services';
import { requireContainerAccess } from '../../../../../utils/auth-helpers';
import { rethrowAsHttpError } from '../../../../../utils/http-errors';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  const appType = getRouterParam(event, 'appType')!;
  const instanceId = getRouterParam(event, 'instanceId')!;
  try {
    const cm = useContainerManager();
    requireContainerAccess(event, cm.get(id));
    await cm.stopAppInstance(id, appType, instanceId);
    return { ok: true };
  } catch (err) {
    rethrowAsHttpError(err);
  }
});
