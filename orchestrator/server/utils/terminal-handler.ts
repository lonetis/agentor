import type { Duplex } from 'node:stream';
import type { Peer } from 'crossws';
import { useDockerService } from './services';
import { getPeerId, getPeerUrl, toBuffer } from './ws-utils';

interface TerminalContext {
  dockerStream?: Duplex;
  execId?: string;
  closed: boolean;
}

const peerContexts = new Map<string, TerminalContext>();

function getTerminalContext(peer: Peer): TerminalContext {
  const id = getPeerId(peer);
  let ctx = peerContexts.get(id);
  if (!ctx) {
    ctx = { closed: false };
    peerContexts.set(id, ctx);
  }
  return ctx;
}

function cleanupPeerContext(peer: Peer): void {
  peerContexts.delete(getPeerId(peer));
}

function parseWsParams(url: string | undefined): { containerId: string; windowIndex: number } | null {
  if (!url) return null;
  const match = url.match(/\/ws\/terminal\/([^/?]+)(?:\/([^/?]+))?/);
  if (!match?.[1]) return null;
  const rawIndex = match[2];
  const windowIndex = rawIndex != null ? parseInt(rawIndex, 10) : 0;
  return { containerId: match[1], windowIndex: Number.isNaN(windowIndex) ? 0 : windowIndex };
}

function handleTerminalOpen(peer: Peer): void {
  const ctx = getTerminalContext(peer);
  const dockerService = useDockerService();
  const params = parseWsParams(getPeerUrl(peer));

  if (!params) {
    try { peer.send('\r\nError: Could not determine container from WebSocket URL\r\n'); } catch {}
    try { peer.close(); } catch {}
    return;
  }

  dockerService
    .execAttachTmuxWindow(params.containerId, params.windowIndex)
    .then(({ exec, stream }) => {
      if (ctx.closed) {
        stream.end();
        return;
      }

      ctx.dockerStream = stream;
      ctx.execId = exec.id;

      stream.on('data', (chunk: Buffer) => {
        if (!ctx.closed) {
          try { peer.send(chunk); } catch {}
        }
      });

      stream.on('end', () => {
        ctx.closed = true;
        cleanupPeerContext(peer);
        try { peer.close(); } catch {}
      });

      stream.on('error', (err) => {
        useLogger().error(`[terminal-ws] Docker stream error: ${err.message}`);
        ctx.closed = true;
        cleanupPeerContext(peer);
        try { peer.close(); } catch {}
      });
    })
    .catch((err) => {
      useLogger().error(`[terminal-ws] Exec error: ${err.message}`);
      try { peer.send(`\r\nError connecting to container: ${err.message}\r\n`); } catch {}
      ctx.closed = true;
      cleanupPeerContext(peer);
      try { peer.close(); } catch {}
    });
}

function handleTerminalMessage(peer: Peer, message: unknown): void {
  const ctx = getTerminalContext(peer);
  if (ctx.closed || !ctx.dockerStream) return;

  const dockerService = useDockerService();

  // Try to detect JSON resize messages
  let text: string | undefined;
  try {
    if (typeof message === 'string') {
      text = message;
    } else {
      const msg = message as { text?: () => string };
      if (typeof msg.text === 'function') {
        text = msg.text();
      } else if (Buffer.isBuffer(message) && message.length < 200) {
        text = message.toString('utf-8');
      }
    }
  } catch {}

  if (text && text.length < 200) {
    try {
      const parsed = JSON.parse(text);
      if (parsed.type === 'resize' && parsed.cols && parsed.rows && ctx.execId) {
        dockerService.resizeExec(ctx.execId, parsed.cols, parsed.rows).catch(() => {});
        return;
      }
    } catch {}
  }

  const raw = toBuffer(message);
  if (raw) ctx.dockerStream.write(raw);
}

function handleTerminalClose(peer: Peer): void {
  const ctx = getTerminalContext(peer);
  if (ctx.closed) return;
  ctx.closed = true;
  ctx.dockerStream?.end();
  cleanupPeerContext(peer);
}

export const terminalWsHandler = {
  open: handleTerminalOpen,
  message: handleTerminalMessage,
  close: handleTerminalClose,
  error: handleTerminalClose,
};
