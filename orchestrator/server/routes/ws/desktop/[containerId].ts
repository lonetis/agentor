defineRouteMeta({
  openAPI: {
    tags: ['Internal'],
    summary: 'Desktop WebSocket relay',
    description: 'WebSocket relay to worker websockify for VNC protocol.',
    operationId: 'wsDesktop',
    parameters: [{ name: 'containerId', in: 'path', required: true, schema: { type: 'string' }, description: 'Container ID' }],
    responses: {
      101: { description: 'WebSocket upgrade' },
    },
  },
});

import { createWsRelayHandlers } from '../../../utils/ws-utils';

export default defineWebSocketHandler(
  createWsRelayHandlers(
    /\/ws\/desktop\/([^/?]+)/,
    (containerName) => `ws://${containerName}:6080/websockify`,
  ),
);
