defineRouteMeta({
  openAPI: {
    tags: ['Internal'],
    summary: 'Editor proxy (root)',
    description: 'Combined HTTP + WebSocket proxy to worker code-server (port 8443) root path.',
    operationId: 'proxyEditorRoot',
    parameters: [{ name: 'containerId', in: 'path', required: true, schema: { type: 'string' }, description: 'Container ID' }],
    responses: {
      200: { description: 'Proxied response' },
      301: { description: 'Redirect to trailing slash' },
      404: { description: 'Container not found' },
    },
  },
});

import { useContainerManager } from '../../../utils/services';
import { createWsRelayHandlers } from '../../../utils/ws-utils';

const wsHandlers = createWsRelayHandlers(
  /\/editor\/([a-f0-9]+)/,
  (containerName) => `ws://${containerName}:8443/`,
);

export default defineEventHandler({
  handler: async (event) => {
    const containerId = getRouterParam(event, 'containerId')!;

    // Redirect to trailing-slash URL so relative paths resolve correctly
    // (e.g., ./static/foo → /editor/{id}/static/foo instead of /editor/static/foo)
    const url = getRequestURL(event);
    if (!url.pathname.endsWith('/')) {
      return sendRedirect(event, `${url.pathname}/${url.search}`, 301);
    }

    const containerManager = useContainerManager();
    const info = containerManager.get(containerId);

    if (!info || info.status !== 'running') {
      throw createError({ statusCode: 404, statusMessage: 'Container not found or not running' });
    }

    const target = `http://${info.name}:8443/${url.search}`;

    return proxyRequest(event, target);
  },

  websocket: wsHandlers,
});
