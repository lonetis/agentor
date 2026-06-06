defineRouteMeta({
  openAPI: {
    tags: ['Internal'],
    summary: 'Desktop proxy',
    description: 'Reverse proxy to worker noVNC desktop (port 6080).',
    operationId: 'proxyDesktop',
    parameters: [
      { name: 'containerId', in: 'path', required: true, schema: { type: 'string' }, description: 'Container ID' },
      { name: 'path', in: 'path', required: true, schema: { type: 'string' }, description: 'Proxied path' },
    ],
    responses: {
      200: { description: 'Proxied response' },
      404: { description: 'Container not found' },
    },
  },
});

import { resolveOwnedRunningContainer } from '../../../utils/auth-helpers';

export default defineEventHandler(async (event) => {
  const containerId = getRouterParam(event, 'containerId')!;
  const path = getRouterParam(event, 'path') || '';

  const info = await resolveOwnedRunningContainer(event, containerId);

  const url = getRequestURL(event);
  const target = `http://${info.containerName}:6080/${path}${url.search}`;
  return proxyRequest(event, target);
});
