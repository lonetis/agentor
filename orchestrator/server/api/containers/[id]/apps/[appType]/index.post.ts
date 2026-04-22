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
      201: {
        description: 'Started app instance',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                port: { type: 'integer' },
                externalPort: { type: 'integer', description: 'Auto-created port mapping (e.g. for ssh)' },
              },
              required: ['id', 'port'],
            },
          },
        },
      },
      400: { description: 'Error starting app', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      409: { description: 'Singleton app already running', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useContainerManager } from '../../../../../utils/services';
import { requireContainerAccess } from '../../../../../utils/auth-helpers';
import { rethrowAsHttpError } from '../../../../../utils/http-errors';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  const appType = getRouterParam(event, 'appType')!;
  try {
    const cm = useContainerManager();
    requireContainerAccess(event, cm.get(id));
    const result = await cm.createAppInstance(id, appType);
    setResponseStatus(event, 201);
    return result;
  } catch (err) {
    rethrowAsHttpError(err);
  }
});
