defineRouteMeta({
  openAPI: {
    tags: ['Apps'],
    summary: 'List app instances',
    description: 'Returns running instances of a specific app type in a container.',
    operationId: 'listAppInstances',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Container ID' },
      { name: 'appType', in: 'path', required: true, schema: { type: 'string' }, description: 'App type (e.g. chromium, socks5)' },
    ],
    responses: {
      200: { description: 'Array of app instances', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/AppInstanceInfo' } } } } },
    },
  },
});

import { useContainerManager } from '../../../../../utils/services';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  const appType = getRouterParam(event, 'appType')!;
  const containerManager = useContainerManager();
  try {
    return await containerManager.listAppInstances(id, appType);
  } catch {
    return [];
  }
});
