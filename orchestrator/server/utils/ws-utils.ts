import { WebSocket } from 'ws';
import type { Peer } from 'crossws';
import { useContainerManager } from './services';
import { authenticateWsPeer } from './auth-helpers';

export function getPeerId(peer: Peer): string {
  return peer.id ?? String(peer);
}

export function getPeerUrl(peer: Peer): string | undefined {
  return peer.request?.url;
}

export function toBuffer(message: unknown): Buffer | null {
  try {
    if (Buffer.isBuffer(message)) return message;
    if (message instanceof Uint8Array) return Buffer.from(message);
    if (typeof message === 'string') return Buffer.from(message);
    const msg = message as { uint8Array?: () => Uint8Array; text?: () => string };
    if (typeof msg.uint8Array === 'function') return Buffer.from(msg.uint8Array());
    if (typeof msg.text === 'function') return Buffer.from(msg.text());
    return Buffer.from(String(message));
  } catch {
    return null;
  }
}

interface RelayContext {
  containerWs?: WebSocket;
  bufferedMessages: Buffer[];
  bufferedBytes: number;
  closed: boolean;
}

const relayContexts = new Map<string, RelayContext>();

// Cap how much a client may buffer while the backend WS finishes its handshake
// (normally sub-second). A flood of pre-handshake data must not grow unbounded.
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

/**
 * Creates crossws WebSocket handlers that relay to a backend WebSocket.
 * Buffers messages while the backend connection is still opening.
 *
 * The route segment captured by `workerIdPattern` is the worker's UUID `id`
 * (passed to `get()`), NOT the Docker container id — the relay forwards to the
 * worker by its stable `containerName` via Docker DNS.
 */
export function createWsRelayHandlers(
  workerIdPattern: RegExp,
  getTargetWsUrl: (containerName: string, workerId: string, peer: Peer) => string,
) {
  return {
    open(peer: Peer) {
      const id = getPeerId(peer);
      const ctx: RelayContext = { bufferedMessages: [], bufferedBytes: 0, closed: false };
      relayContexts.set(id, ctx);

      const url = getPeerUrl(peer);
      const workerId = url ? workerIdPattern.exec(url)?.[1] : null;
      if (!workerId) {
        relayContexts.delete(id);
        try { peer.close(); } catch {}
        return;
      }

      const info = useContainerManager().get(workerId);
      if (!info || info.status !== 'running') {
        relayContexts.delete(id);
        try { peer.close(); } catch {}
        return;
      }

      // Authenticate and verify ownership before opening the relay
      authenticateWsPeer(peer).then((auth) => {
        if (ctx.closed) return;
        if (!auth) {
          ctx.closed = true;
          relayContexts.delete(id);
          try { peer.close(); } catch {}
          return;
        }
        if (auth.user.role !== 'admin' && info.userId !== auth.user.id) {
          ctx.closed = true;
          relayContexts.delete(id);
          try { peer.close(); } catch {}
          return;
        }

        const ws = new WebSocket(getTargetWsUrl(info.containerName, workerId, peer));
        ctx.containerWs = ws;

        ws.on('open', () => {
          for (const msg of ctx.bufferedMessages) ws.send(msg);
          ctx.bufferedMessages = [];
          ctx.bufferedBytes = 0;
        });

        ws.on('message', (data: Buffer) => {
          if (ctx.closed) return;
          try { peer.send(data); } catch {}
        });

        ws.on('close', () => {
          if (ctx.closed) return;
          ctx.closed = true;
          relayContexts.delete(id);
          try { peer.close(); } catch {}
        });

        ws.on('error', () => {
          if (ctx.closed) return;
          ctx.closed = true;
          relayContexts.delete(id);
          try { peer.close(); } catch {}
        });
      }).catch(() => {
        ctx.closed = true;
        relayContexts.delete(id);
        try { peer.close(); } catch {}
      });
    },

    message(peer: Peer, message: unknown) {
      const id = getPeerId(peer);
      const ctx = relayContexts.get(id);
      if (!ctx || ctx.closed) return;

      const raw = toBuffer(message);
      if (!raw) return;

      if (ctx.containerWs?.readyState === WebSocket.OPEN) {
        ctx.containerWs.send(raw);
      } else if (!ctx.containerWs || ctx.containerWs.readyState === WebSocket.CONNECTING) {
        // Backend WS not open yet (still resolving auth or mid-handshake) —
        // buffer, but bail out if a flood blows past the cap.
        if (ctx.bufferedBytes + raw.length > MAX_BUFFERED_BYTES) {
          ctx.closed = true;
          relayContexts.delete(id);
          try { ctx.containerWs?.close(); } catch {}
          try { peer.close(); } catch {}
          return;
        }
        ctx.bufferedMessages.push(raw);
        ctx.bufferedBytes += raw.length;
      }
    },

    close(peer: Peer) {
      const id = getPeerId(peer);
      const ctx = relayContexts.get(id);
      if (!ctx) return;
      ctx.closed = true;
      try { ctx.containerWs?.close(); } catch {}
      relayContexts.delete(id);
    },

    error(peer: Peer) {
      const id = getPeerId(peer);
      const ctx = relayContexts.get(id);
      if (!ctx) return;
      ctx.closed = true;
      try { ctx.containerWs?.close(); } catch {}
      relayContexts.delete(id);
    },
  };
}
