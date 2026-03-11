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

export default defineWebSocketHandler({
  open(peer) {
    useLogBroadcaster().addPeer(peer);
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
