defineRouteMeta({
  openAPI: {
    tags: ['Apps'],
    summary: 'Start app instance',
    description: 'Starts a new instance of the specified app type in a container.',
    operationId: 'startAppInstance',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Container ID' },
      { name: 'appType', in: 'path', required: true, schema: { type: 'string' }, description: 'App type (e.g. chromium, socks5)' },
    ],
    responses: {
      201: { description: 'Started app instance', content: { 'application/json': { schema: { $ref: '#/components/schemas/AppInstanceInfo' } } } },
      400: { description: 'Error starting app', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useContainerManager } from '../../../../../utils/services';
import { requireContainerAccess } from '../../../../../utils/auth-helpers';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  const appType = getRouterParam(event, 'appType')!;
  try {
    const containerManager = useContainerManager();
    requireContainerAccess(event, containerManager.get(id));
    const result = await containerManager.createAppInstance(id, appType);
    setResponseStatus(event, 201);
    return result;
  } catch (err: unknown) {
    if ((err as any)?.statusCode) throw err;
    const message = err instanceof Error ? err.message : 'Operation failed';
    throw createError({ statusCode: 500, statusMessage: message });
  }
});
