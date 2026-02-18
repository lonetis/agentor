import { createWsRelayHandlers } from '../../../utils/ws-utils';

export default defineWebSocketHandler(
  createWsRelayHandlers(
    /\/ws\/desktop\/([^/?]+)/,
    (containerName) => `ws://${containerName}:6080/websockify`,
  ),
);
