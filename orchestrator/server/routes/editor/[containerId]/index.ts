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

import { createWsRelayHandlers } from '../../../utils/ws-utils';
import { resolveOwnedRunningContainer } from '../../../utils/auth-helpers';

const wsHandlers = createWsRelayHandlers(
  // The worker id is a UUID (with hyphens) — match the whole segment, not just hex.
  /\/editor\/([^/?]+)/,
  (containerName) => `ws://${containerName}:8443/`,
);

export default defineEventHandler({
  handler: async (event) => {
    const containerId = getRouterParam(event, 'containerId')!;

    // Authenticate + ownership-check BEFORE the trailing-slash redirect so an
    // unauthenticated/unowned caller never gets a 301 (which would double as a
    // route-existence oracle). Mirrors the [...path] handler's ordering.
    const info = await resolveOwnedRunningContainer(event, containerId);

    // Redirect to trailing-slash URL so relative paths resolve correctly
    // (e.g., ./static/foo → /editor/{id}/static/foo instead of /editor/static/foo)
    const url = getRequestURL(event);
    if (!url.pathname.endsWith('/')) {
      return sendRedirect(event, `${url.pathname}/${url.search}`, 301);
    }

    const target = `http://${info.containerName}:8443/${url.search}`;
    return proxyRequest(event, target);
  },

  websocket: wsHandlers,
});
