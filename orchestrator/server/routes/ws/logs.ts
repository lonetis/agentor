defineRouteMeta({
  openAPI: {
    tags: ['Internal'],
    summary: 'Log stream WebSocket',
    description: 'Live log entry stream. Server sends JSON-encoded LogEntry objects.',
    operationId: 'wsLogs',
    responses: {
      101: { description: 'WebSocket upgrade' },
    },
  },
});

import { authenticateWsPeer } from '../../utils/auth-helpers';

export default defineWebSocketHandler({
  open(peer) {
    authenticateWsPeer(peer).then((auth) => {
      if (!auth || auth.user.role !== 'admin') {
        try { peer.close(); } catch {}
        return;
      }
      useLogBroadcaster().addPeer(peer);
    }).catch(() => {
      try { peer.close(); } catch {}
    });
  },
  close(peer) {
    useLogBroadcaster().removePeer(peer);
  },
  error(peer) {
    useLogBroadcaster().removePeer(peer);
  },
  message() {
    // Read-only stream — clients don't send messages
  },
});
