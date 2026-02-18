import { useContainerManager } from '../../../utils/services';
import { createWsRelayHandlers, getPeerUrl } from '../../../utils/ws-utils';

const wsHandlers = createWsRelayHandlers(
  /\/editor\/([a-f0-9]+)/,
  (containerName, containerId, peer) => {
    const url = getPeerUrl(peer);
    const prefix = `/editor/${containerId}`;
    const idx = url?.indexOf(prefix) ?? -1;
    const targetPath = idx !== -1 ? url!.slice(idx + prefix.length) || '/' : '/';
    return `ws://${containerName}:8443${targetPath}`;
  },
);

export default defineEventHandler({
  handler: async (event) => {
    const containerId = getRouterParam(event, 'containerId')!;
    const path = getRouterParam(event, 'path') || '';

    const containerManager = useContainerManager();
    const info = containerManager.get(containerId);

    if (!info || info.status !== 'running') {
      throw createError({ statusCode: 404, statusMessage: 'Container not found or not running' });
    }

    const url = getRequestURL(event);
    const target = `http://${info.name}:8443/${path}${url.search}`;

    return proxyRequest(event, target);
  },

  websocket: wsHandlers,
});
