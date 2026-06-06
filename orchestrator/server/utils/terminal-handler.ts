import type { Duplex } from 'node:stream';
import type { Peer } from 'crossws';
import { useDockerService, useContainerManager } from './services';
import { getPeerId, getPeerUrl, toBuffer } from './ws-utils';
import { authenticateWsPeer } from './auth-helpers';

interface TerminalContext {
  dockerStream?: Duplex;
  execId?: string;
  /** The Docker container id (resolved from the worker UUID) for tmux cleanup. */
  dockerContainerId?: string;
  tmuxSession?: string;
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

// The first capture is the worker's UUID `id` (the route segment), NOT a Docker
// container id — the handler resolves the live Docker container id from it.
function parseWsParams(url: string | undefined): { workerId: string; windowIndex: number } | null {
  if (!url) return null;
  const match = url.match(/\/ws\/terminal\/([^/?]+)(?:\/([^/?]+))?/);
  if (!match?.[1]) return null;
  const rawIndex = match[2];
  const windowIndex = rawIndex != null ? parseInt(rawIndex, 10) : 0;
  return { workerId: match[1], windowIndex: Number.isNaN(windowIndex) ? 0 : windowIndex };
}

function cleanupTerminal(ctx: TerminalContext, peer: Peer): void {
  if (ctx.closed) return;
  ctx.closed = true;
  ctx.dockerStream?.end();
  if (ctx.dockerContainerId && ctx.tmuxSession) {
    useDockerService().killTmuxSession(ctx.dockerContainerId, ctx.tmuxSession);
  }
  cleanupPeerContext(peer);
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

  // Authenticate & authorize before opening the Docker exec
  (async () => {
    const auth = await authenticateWsPeer(peer);
    if (!auth) {
      try { peer.send('\r\nUnauthorized\r\n'); } catch {}
      try { peer.close(); } catch {}
      return;
    }
    const info = useContainerManager().get(params.workerId);
    if (!info) {
      try { peer.send('\r\nContainer not found\r\n'); } catch {}
      try { peer.close(); } catch {}
      return;
    }
    if (auth.user.role !== 'admin' && info.userId !== auth.user.id) {
      try { peer.send('\r\nForbidden\r\n'); } catch {}
      try { peer.close(); } catch {}
      return;
    }

    // `params.workerId` is the worker's UUID `id` (the route segment); Docker
    // exec needs the actual Docker container id, which lives on the resolved info.
    const dockerContainerId = info.containerId;
    dockerService
    .execAttachTmuxWindow(dockerContainerId, params.windowIndex)
    .then(({ exec, stream, tmuxSession }) => {
      if (ctx.closed) {
        stream.end();
        dockerService.killTmuxSession(dockerContainerId, tmuxSession);
        return;
      }

      ctx.dockerStream = stream;
      ctx.execId = exec.id;
      ctx.dockerContainerId = dockerContainerId;
      ctx.tmuxSession = tmuxSession;

      stream.on('data', (chunk: Buffer) => {
        if (ctx.closed) return;
        try {
          peer.send(chunk);
        } catch {
          // peer.send() failure means the WebSocket is disconnected — clean up
          cleanupTerminal(ctx, peer);
        }
      });

      stream.on('end', () => {
        cleanupTerminal(ctx, peer);
        try { peer.close(); } catch {}
      });

      stream.on('error', (err) => {
        useLogger().error(`[terminal-ws] Docker stream error: ${err.message}`);
        cleanupTerminal(ctx, peer);
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
  })();
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

  // Only attempt a JSON parse when the frame actually looks like a resize
  // object (`{...}`). Interactive keystrokes are the hot path and never start
  // with `{`, so this avoids a throw-and-catch on every character typed.
  if (text && text.length < 200 && text.charCodeAt(0) === 0x7b /* '{' */) {
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
  cleanupTerminal(ctx, peer);
}

export const terminalWsHandler = {
  open: handleTerminalOpen,
  message: handleTerminalMessage,
  close: handleTerminalClose,
  error: handleTerminalClose,
};
