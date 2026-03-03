import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';

// Mock the services module
const mockExecAttachTmuxWindow = vi.fn();
const mockResizeExec = vi.fn().mockResolvedValue(undefined);
vi.mock('../../utils/services', () => ({
  useDockerService: vi.fn(() => ({
    execAttachTmuxWindow: mockExecAttachTmuxWindow,
    resizeExec: mockResizeExec,
  })),
  useContainerManager: vi.fn(),
}));

import { terminalWsHandler } from '../../utils/terminal-handler';

function makePeer(id: string, url?: string) {
  return {
    id,
    request: url ? { url } : undefined,
    send: vi.fn(),
    close: vi.fn(),
  } as any;
}

function makeMockStream(): Duplex & EventEmitter {
  const stream = new EventEmitter() as any;
  stream.write = vi.fn();
  stream.end = vi.fn();
  return stream;
}

describe('terminalWsHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('open', () => {
    it('sends error and closes peer when URL is missing', () => {
      const peer = makePeer('p1');
      terminalWsHandler.open(peer);
      expect(peer.send).toHaveBeenCalledWith(expect.stringContaining('Error'));
      expect(peer.close).toHaveBeenCalled();
    });

    it('sends error and closes peer when URL pattern does not match', () => {
      const peer = makePeer('p2', '/some/other/path');
      terminalWsHandler.open(peer);
      expect(peer.send).toHaveBeenCalledWith(expect.stringContaining('Error'));
      expect(peer.close).toHaveBeenCalled();
    });

    it('connects to default main window when no windowName', async () => {
      const stream = makeMockStream();
      mockExecAttachTmuxWindow.mockResolvedValueOnce({
        exec: { id: 'exec-1' },
        stream,
      });

      const peer = makePeer('p3', '/ws/terminal/container-abc');
      terminalWsHandler.open(peer);

      // Wait for async exec to complete
      await vi.waitFor(() => {
        expect(mockExecAttachTmuxWindow).toHaveBeenCalledWith('container-abc', 'main');
      });
    });

    it('connects to specified tmux window', async () => {
      const stream = makeMockStream();
      mockExecAttachTmuxWindow.mockResolvedValueOnce({
        exec: { id: 'exec-2' },
        stream,
      });

      const peer = makePeer('p4', '/ws/terminal/container-xyz/my-shell');
      terminalWsHandler.open(peer);

      await vi.waitFor(() => {
        expect(mockExecAttachTmuxWindow).toHaveBeenCalledWith('container-xyz', 'my-shell');
      });
    });

    it('relays docker stream data to peer', async () => {
      const stream = makeMockStream();
      mockExecAttachTmuxWindow.mockResolvedValueOnce({
        exec: { id: 'exec-3' },
        stream,
      });

      const peer = makePeer('p5', '/ws/terminal/c1');
      terminalWsHandler.open(peer);

      await vi.waitFor(() => {
        expect(mockExecAttachTmuxWindow).toHaveBeenCalled();
      });

      // Simulate data from docker stream
      stream.emit('data', Buffer.from('hello terminal'));
      expect(peer.send).toHaveBeenCalledWith(Buffer.from('hello terminal'));
    });

    it('closes peer when docker stream ends', async () => {
      const stream = makeMockStream();
      mockExecAttachTmuxWindow.mockResolvedValueOnce({
        exec: { id: 'exec-4' },
        stream,
      });

      const peer = makePeer('p6', '/ws/terminal/c1');
      terminalWsHandler.open(peer);

      await vi.waitFor(() => {
        expect(mockExecAttachTmuxWindow).toHaveBeenCalled();
      });

      stream.emit('end');
      expect(peer.close).toHaveBeenCalled();
    });

    it('closes peer on docker stream error', async () => {
      const stream = makeMockStream();
      mockExecAttachTmuxWindow.mockResolvedValueOnce({
        exec: { id: 'exec-5' },
        stream,
      });

      const peer = makePeer('p7', '/ws/terminal/c1');
      terminalWsHandler.open(peer);

      await vi.waitFor(() => {
        expect(mockExecAttachTmuxWindow).toHaveBeenCalled();
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      stream.emit('error', new Error('stream broke'));
      expect(peer.close).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('sends error to peer on exec rejection', async () => {
      mockExecAttachTmuxWindow.mockRejectedValueOnce(new Error('container not found'));

      const peer = makePeer('p8', '/ws/terminal/c1');
      terminalWsHandler.open(peer);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await vi.waitFor(() => {
        expect(peer.send).toHaveBeenCalledWith(expect.stringContaining('container not found'));
      });
      expect(peer.close).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('ends docker stream if peer already closed before exec resolves', async () => {
      const stream = makeMockStream();
      // Delay exec resolution
      mockExecAttachTmuxWindow.mockImplementation(async () => {
        return { exec: { id: 'exec-6' }, stream };
      });

      const peer = makePeer('p9', '/ws/terminal/c1');
      terminalWsHandler.open(peer);
      // Close the peer before exec resolves
      terminalWsHandler.close(peer);

      await vi.waitFor(() => {
        expect(mockExecAttachTmuxWindow).toHaveBeenCalled();
      });

      // The stream should be ended since ctx.closed was true
      expect(stream.end).toHaveBeenCalled();
    });
  });

  describe('message', () => {
    it('ignores messages when context is closed', () => {
      const peer = makePeer('pm1', '/ws/terminal/c1');
      // Open then immediately close
      terminalWsHandler.open(peer);
      terminalWsHandler.close(peer);
      // Should not throw
      terminalWsHandler.message(peer, 'hello');
    });

    it('ignores messages when no docker stream is attached', () => {
      const peer = makePeer('pm2', '/ws/terminal/c1');
      // Open but exec hasn't resolved yet
      mockExecAttachTmuxWindow.mockImplementation(() => new Promise(() => {})); // never resolves
      terminalWsHandler.open(peer);
      // Should not throw — dockerStream is undefined
      terminalWsHandler.message(peer, 'hello');
    });

    it('forwards regular messages to docker stream', async () => {
      const stream = makeMockStream();
      mockExecAttachTmuxWindow.mockResolvedValueOnce({
        exec: { id: 'exec-msg' },
        stream,
      });

      const peer = makePeer('pm3', '/ws/terminal/c1');
      terminalWsHandler.open(peer);

      await vi.waitFor(() => {
        expect(mockExecAttachTmuxWindow).toHaveBeenCalled();
      });

      terminalWsHandler.message(peer, 'ls -la');
      expect(stream.write).toHaveBeenCalledWith(Buffer.from('ls -la'));
    });

    it('handles resize JSON messages', async () => {
      const stream = makeMockStream();
      mockExecAttachTmuxWindow.mockResolvedValueOnce({
        exec: { id: 'exec-resize' },
        stream,
      });

      const peer = makePeer('pm4', '/ws/terminal/c1');
      terminalWsHandler.open(peer);

      await vi.waitFor(() => {
        expect(mockExecAttachTmuxWindow).toHaveBeenCalled();
      });

      const resizeMsg = JSON.stringify({ type: 'resize', cols: 120, rows: 40 });
      terminalWsHandler.message(peer, resizeMsg);

      expect(mockResizeExec).toHaveBeenCalledWith('exec-resize', 120, 40);
      // Should NOT write resize to stream
      expect(stream.write).not.toHaveBeenCalled();
    });

    it('handles message object with text() method', async () => {
      const stream = makeMockStream();
      mockExecAttachTmuxWindow.mockResolvedValueOnce({
        exec: { id: 'exec-text' },
        stream,
      });

      const peer = makePeer('pm5', '/ws/terminal/c1');
      terminalWsHandler.open(peer);

      await vi.waitFor(() => {
        expect(mockExecAttachTmuxWindow).toHaveBeenCalled();
      });

      const msg = { text: () => 'echo hello' };
      terminalWsHandler.message(peer, msg);
      expect(stream.write).toHaveBeenCalledWith(Buffer.from('echo hello'));
    });

    it('handles Buffer messages for resize detection', async () => {
      const stream = makeMockStream();
      mockExecAttachTmuxWindow.mockResolvedValueOnce({
        exec: { id: 'exec-buf-resize' },
        stream,
      });

      const peer = makePeer('pm6', '/ws/terminal/c1');
      terminalWsHandler.open(peer);

      await vi.waitFor(() => {
        expect(mockExecAttachTmuxWindow).toHaveBeenCalled();
      });

      const resizeBuf = Buffer.from(JSON.stringify({ type: 'resize', cols: 80, rows: 24 }));
      terminalWsHandler.message(peer, resizeBuf);

      expect(mockResizeExec).toHaveBeenCalledWith('exec-buf-resize', 80, 24);
    });

    it('does not try to parse large messages as JSON', async () => {
      const stream = makeMockStream();
      mockExecAttachTmuxWindow.mockResolvedValueOnce({
        exec: { id: 'exec-large' },
        stream,
      });

      const peer = makePeer('pm7', '/ws/terminal/c1');
      terminalWsHandler.open(peer);

      await vi.waitFor(() => {
        expect(mockExecAttachTmuxWindow).toHaveBeenCalled();
      });

      // Large buffer >200 bytes — should be written directly, not parsed
      const largeBuf = Buffer.alloc(300, 'a');
      terminalWsHandler.message(peer, largeBuf);
      expect(stream.write).toHaveBeenCalledWith(largeBuf);
      expect(mockResizeExec).not.toHaveBeenCalled();
    });
  });

  describe('close', () => {
    it('ends docker stream and cleans up context', async () => {
      const stream = makeMockStream();
      mockExecAttachTmuxWindow.mockResolvedValueOnce({
        exec: { id: 'exec-close' },
        stream,
      });

      const peer = makePeer('pc1', '/ws/terminal/c1');
      terminalWsHandler.open(peer);

      await vi.waitFor(() => {
        expect(mockExecAttachTmuxWindow).toHaveBeenCalled();
      });

      terminalWsHandler.close(peer);
      expect(stream.end).toHaveBeenCalled();
    });

    it('is idempotent (second close is no-op)', async () => {
      const stream = makeMockStream();
      mockExecAttachTmuxWindow.mockResolvedValueOnce({
        exec: { id: 'exec-close2' },
        stream,
      });

      const peer = makePeer('pc2', '/ws/terminal/c1');
      terminalWsHandler.open(peer);

      await vi.waitFor(() => {
        expect(mockExecAttachTmuxWindow).toHaveBeenCalled();
      });

      terminalWsHandler.close(peer);
      terminalWsHandler.close(peer);
      // end should only be called once
      expect(stream.end).toHaveBeenCalledTimes(1);
    });
  });

  describe('error', () => {
    it('closes the connection like close handler', async () => {
      const stream = makeMockStream();
      mockExecAttachTmuxWindow.mockResolvedValueOnce({
        exec: { id: 'exec-err' },
        stream,
      });

      const peer = makePeer('pe1', '/ws/terminal/c1');
      terminalWsHandler.open(peer);

      await vi.waitFor(() => {
        expect(mockExecAttachTmuxWindow).toHaveBeenCalled();
      });

      terminalWsHandler.error(peer);
      expect(stream.end).toHaveBeenCalled();
    });
  });
});
