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

import { useContainerManager } from '../../../utils/services';

export default defineEventHandler(async (event) => {
  const containerId = getRouterParam(event, 'containerId')!;
  const path = getRouterParam(event, 'path') || '';

  const containerManager = useContainerManager();
  const info = containerManager.get(containerId);

  if (!info || info.status !== 'running') {
    throw createError({ statusCode: 404, statusMessage: 'Container not found or not running' });
  }

  const url = getRequestURL(event);
  const target = `http://${info.name}:6080/${path}${url.search}`;

  return proxyRequest(event, target);
});
