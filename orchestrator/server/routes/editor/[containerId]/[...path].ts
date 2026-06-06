defineRouteMeta({
  openAPI: {
    tags: ['Internal'],
    summary: 'Editor proxy (subpath)',
    description: 'Combined HTTP + WebSocket proxy to worker code-server (port 8443) sub-paths.',
    operationId: 'proxyEditorSubpath',
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

import { createWsRelayHandlers, getPeerUrl } from '../../../utils/ws-utils';
import { resolveOwnedRunningContainer } from '../../../utils/auth-helpers';

const wsHandlers = createWsRelayHandlers(
  // The worker id is a UUID (with hyphens) — match the whole segment, not just hex.
  /\/editor\/([^/?]+)/,
  (containerName, workerId, peer) => {
    const url = getPeerUrl(peer);
    const prefix = `/editor/${workerId}`;
    const idx = url?.indexOf(prefix) ?? -1;
    const targetPath = idx !== -1 ? url!.slice(idx + prefix.length) || '/' : '/';
    return `ws://${containerName}:8443${targetPath}`;
  },
);

export default defineEventHandler({
  handler: async (event) => {
    const containerId = getRouterParam(event, 'containerId')!;
    const path = getRouterParam(event, 'path') || '';

    const info = await resolveOwnedRunningContainer(event, containerId);

    const url = getRequestURL(event);
    const target = `http://${info.containerName}:8443/${path}${url.search}`;
    return proxyRequest(event, target);
  },

  websocket: wsHandlers,
});
