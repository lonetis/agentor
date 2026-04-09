import { WebSocket } from 'ws';
import type { Peer } from 'crossws';
import { useContainerManager } from './services';
import { authenticateWsPeer } from './auth-helpers';

export function getPeerId(peer: Peer): string {
  return peer.id ?? String(peer);
}

export function getPeerUrl(peer: Peer): string | undefined {
  try { return peer.request?.url; } catch { return undefined; }
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
  closed: boolean;
}

const relayContexts = new Map<string, RelayContext>();

/**
 * Creates crossws WebSocket handlers that relay to a backend WebSocket.
 * Buffers messages while the backend connection is still opening.
 */
export function createWsRelayHandlers(
  containerIdPattern: RegExp,
  getTargetWsUrl: (containerName: string, containerId: string, peer: Peer) => string,
) {
  return {
    open(peer: Peer) {
      const id = getPeerId(peer);
      const ctx: RelayContext = { bufferedMessages: [], closed: false };
      relayContexts.set(id, ctx);

      const url = getPeerUrl(peer);
      const containerId = url ? containerIdPattern.exec(url)?.[1] : null;
      if (!containerId) {
        relayContexts.delete(id);
        try { peer.close(); } catch {}
        return;
      }

      const info = useContainerManager().get(containerId);
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

        const ws = new WebSocket(getTargetWsUrl(info.name, containerId, peer));
        ctx.containerWs = ws;

        ws.on('open', () => {
          for (const msg of ctx.bufferedMessages) ws.send(msg);
          ctx.bufferedMessages = [];
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
      } else if (ctx.containerWs?.readyState === WebSocket.CONNECTING) {
        ctx.bufferedMessages.push(raw);
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
