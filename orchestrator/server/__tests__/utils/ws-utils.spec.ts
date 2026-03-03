import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the ws module — use a simple class instead of extending EventEmitter in the factory
const mockWsSend = vi.fn();
const mockWsClose = vi.fn();
let mockWsReadyState = 1; // OPEN
let mockWsEventHandlers: Record<string, ((...args: any[]) => void)[]> = {};

vi.mock('ws', () => {
  class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    url: string;
    send = mockWsSend;
    close = mockWsClose;

    constructor(url: string) {
      this.url = url;
      mockWsEventHandlers = {};
    }

    get readyState() {
      return mockWsReadyState;
    }

    on(event: string, handler: (...args: any[]) => void) {
      if (!mockWsEventHandlers[event]) mockWsEventHandlers[event] = [];
      mockWsEventHandlers[event].push(handler);
      return this;
    }
  }

  return { WebSocket: MockWebSocket };
});

// Mock the services import
const mockContainerManagerGet = vi.fn();
vi.mock('../../utils/services', () => ({
  useContainerManager: vi.fn(() => ({
    get: mockContainerManagerGet,
  })),
}));

import { toBuffer, getPeerId, getPeerUrl, createWsRelayHandlers } from '../../utils/ws-utils';

function makePeer(id: string, url?: string) {
  return {
    id,
    request: url !== undefined ? { url } : undefined,
    send: vi.fn(),
    close: vi.fn(),
  } as any;
}

function emitWsEvent(event: string, ...args: any[]) {
  const handlers = mockWsEventHandlers[event] || [];
  for (const handler of handlers) handler(...args);
}

describe('toBuffer', () => {
  it('returns same Buffer for Buffer input', () => {
    const buf = Buffer.from('hello');
    const result = toBuffer(buf);
    expect(result).toBe(buf);
  });

  it('converts Uint8Array to Buffer', () => {
    const arr = new Uint8Array([72, 101, 108, 108, 111]);
    const result = toBuffer(arr);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result!.toString()).toBe('Hello');
  });

  it('converts string to Buffer', () => {
    const result = toBuffer('hello');
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result!.toString()).toBe('hello');
  });

  it('converts object with uint8Array() method', () => {
    const msg = { uint8Array: () => new Uint8Array([65, 66]) };
    const result = toBuffer(msg);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result!.toString()).toBe('AB');
  });

  it('converts object with text() method', () => {
    const msg = { text: () => 'world' };
    const result = toBuffer(msg);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result!.toString()).toBe('world');
  });

  it('converts unknown objects via String()', () => {
    const result = toBuffer(42);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result!.toString()).toBe('42');
  });

  it('returns null when conversion throws', () => {
    const poison = {
      uint8Array() { throw new Error('boom'); },
      text() { throw new Error('boom'); },
      toString() { throw new Error('boom'); },
    };
    const result = toBuffer(poison);
    expect(result).toBeNull();
  });
});

describe('getPeerId', () => {
  it('returns peer.id when available', () => {
    const peer = { id: 'abc-123' } as any;
    expect(getPeerId(peer)).toBe('abc-123');
  });

  it('falls back to String(peer) when id is undefined', () => {
    const peer = {
      id: undefined,
      toString() { return 'peer-fallback'; },
    } as any;
    expect(getPeerId(peer)).toBe('peer-fallback');
  });
});

describe('getPeerUrl', () => {
  it('returns request URL when available', () => {
    const peer = { request: { url: '/ws/desktop/c1' } } as any;
    expect(getPeerUrl(peer)).toBe('/ws/desktop/c1');
  });

  it('returns undefined when request is missing', () => {
    const peer = {} as any;
    expect(getPeerUrl(peer)).toBeUndefined();
  });

  it('returns undefined when accessing request throws', () => {
    const peer = {
      get request(): any { throw new Error('no request'); },
    } as any;
    expect(getPeerUrl(peer)).toBeUndefined();
  });
});

describe('createWsRelayHandlers', () => {
  const pattern = /\/ws\/desktop\/([^/?]+)/;
  const getTargetUrl = (name: string, _id: string, _peer: any) =>
    `ws://${name}:6080/websockify`;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWsReadyState = 1; // OPEN
    mockWsEventHandlers = {};
  });

  describe('open', () => {
    it('closes peer when URL does not match pattern', () => {
      const handlers = createWsRelayHandlers(pattern, getTargetUrl);
      const peer = makePeer('r1', '/some/other/path');
      handlers.open(peer);
      expect(peer.close).toHaveBeenCalled();
    });

    it('closes peer when no URL available', () => {
      const handlers = createWsRelayHandlers(pattern, getTargetUrl);
      const peer = makePeer('r2');
      handlers.open(peer);
      expect(peer.close).toHaveBeenCalled();
    });

    it('closes peer when container not found', () => {
      mockContainerManagerGet.mockReturnValue(undefined);
      const handlers = createWsRelayHandlers(pattern, getTargetUrl);
      const peer = makePeer('r3', '/ws/desktop/c1');
      handlers.open(peer);
      expect(peer.close).toHaveBeenCalled();
    });

    it('closes peer when container is not running', () => {
      mockContainerManagerGet.mockReturnValue({ name: 'w1', status: 'stopped' });
      const handlers = createWsRelayHandlers(pattern, getTargetUrl);
      const peer = makePeer('r4', '/ws/desktop/c1');
      handlers.open(peer);
      expect(peer.close).toHaveBeenCalled();
    });

    it('creates WebSocket to target URL when container is running', () => {
      mockContainerManagerGet.mockReturnValue({ name: 'my-worker', status: 'running' });
      const handlers = createWsRelayHandlers(pattern, getTargetUrl);
      const peer = makePeer('r5', '/ws/desktop/c1');
      handlers.open(peer);
      // Event handlers were registered on the mock WebSocket
      expect(mockWsEventHandlers['open']).toBeDefined();
      expect(mockWsEventHandlers['message']).toBeDefined();
      expect(mockWsEventHandlers['close']).toBeDefined();
      expect(mockWsEventHandlers['error']).toBeDefined();
    });

    it('flushes buffered messages when backend WS opens', () => {
      mockContainerManagerGet.mockReturnValue({ name: 'w1', status: 'running' });
      mockWsReadyState = 0; // CONNECTING initially
      const handlers = createWsRelayHandlers(pattern, getTargetUrl);
      const peer = makePeer('r6', '/ws/desktop/c1');
      handlers.open(peer);

      // Buffer a message while connecting
      handlers.message(peer, 'buffered-data');

      // Now simulate backend WS opening
      emitWsEvent('open');
      expect(mockWsSend).toHaveBeenCalledWith(Buffer.from('buffered-data'));
    });

    it('relays backend WS messages to peer', () => {
      mockContainerManagerGet.mockReturnValue({ name: 'w1', status: 'running' });
      const handlers = createWsRelayHandlers(pattern, getTargetUrl);
      const peer = makePeer('r7', '/ws/desktop/c1');
      handlers.open(peer);

      // Simulate message from backend
      emitWsEvent('message', Buffer.from('backend-data'));
      expect(peer.send).toHaveBeenCalledWith(Buffer.from('backend-data'));
    });

    it('does not relay backend messages after peer closed', () => {
      mockContainerManagerGet.mockReturnValue({ name: 'w1', status: 'running' });
      const handlers = createWsRelayHandlers(pattern, getTargetUrl);
      const peer = makePeer('r8', '/ws/desktop/c1');
      handlers.open(peer);
      handlers.close(peer);

      // Simulate message from backend after close
      emitWsEvent('message', Buffer.from('late-data'));
      expect(peer.send).not.toHaveBeenCalled();
    });

    it('closes peer when backend WS closes', () => {
      mockContainerManagerGet.mockReturnValue({ name: 'w1', status: 'running' });
      const handlers = createWsRelayHandlers(pattern, getTargetUrl);
      const peer = makePeer('r9', '/ws/desktop/c1');
      handlers.open(peer);

      emitWsEvent('close');
      expect(peer.close).toHaveBeenCalled();
    });

    it('does not close peer twice on backend close after already closed', () => {
      mockContainerManagerGet.mockReturnValue({ name: 'w1', status: 'running' });
      const handlers = createWsRelayHandlers(pattern, getTargetUrl);
      const peer = makePeer('r10', '/ws/desktop/c1');
      handlers.open(peer);
      handlers.close(peer);

      // Backend close arrives late — should be no-op
      emitWsEvent('close');
      // peer.close was called once by handlers.close(), not again
      expect(peer.close).toHaveBeenCalledTimes(0); // peer.close is called by the relay, not directly
    });

    it('closes peer on backend WS error', () => {
      mockContainerManagerGet.mockReturnValue({ name: 'w1', status: 'running' });
      const handlers = createWsRelayHandlers(pattern, getTargetUrl);
      const peer = makePeer('r11', '/ws/desktop/c1');
      handlers.open(peer);

      emitWsEvent('error');
      expect(peer.close).toHaveBeenCalled();
    });
  });

  describe('message', () => {
    it('ignores messages when no context exists', () => {
      const handlers = createWsRelayHandlers(pattern, getTargetUrl);
      const peer = makePeer('m1', '/ws/desktop/c1');
      handlers.message(peer, 'hello');
      expect(mockWsSend).not.toHaveBeenCalled();
    });

    it('ignores messages when context is closed', () => {
      mockContainerManagerGet.mockReturnValue({ name: 'w1', status: 'running' });
      const handlers = createWsRelayHandlers(pattern, getTargetUrl);
      const peer = makePeer('m2', '/ws/desktop/c1');
      handlers.open(peer);
      handlers.close(peer);
      handlers.message(peer, 'hello');
      expect(mockWsSend).not.toHaveBeenCalled();
    });

    it('sends data to container WS when it is OPEN', () => {
      mockContainerManagerGet.mockReturnValue({ name: 'w1', status: 'running' });
      mockWsReadyState = 1; // OPEN
      const handlers = createWsRelayHandlers(pattern, getTargetUrl);
      const peer = makePeer('m3', '/ws/desktop/c1');
      handlers.open(peer);
      handlers.message(peer, 'data');
      expect(mockWsSend).toHaveBeenCalledWith(Buffer.from('data'));
    });

    it('buffers messages when container WS is CONNECTING', () => {
      mockContainerManagerGet.mockReturnValue({ name: 'w1', status: 'running' });
      mockWsReadyState = 0; // CONNECTING
      const handlers = createWsRelayHandlers(pattern, getTargetUrl);
      const peer = makePeer('m4', '/ws/desktop/c1');
      handlers.open(peer);
      handlers.message(peer, 'buffered-data');
      expect(mockWsSend).not.toHaveBeenCalled();
    });

    it('ignores null toBuffer results', () => {
      mockContainerManagerGet.mockReturnValue({ name: 'w1', status: 'running' });
      const handlers = createWsRelayHandlers(pattern, getTargetUrl);
      const peer = makePeer('m5', '/ws/desktop/c1');
      handlers.open(peer);
      const poison = {
        uint8Array() { throw new Error('fail'); },
        text() { throw new Error('fail'); },
        toString() { throw new Error('fail'); },
      };
      handlers.message(peer, poison);
      expect(mockWsSend).not.toHaveBeenCalled();
    });
  });

  describe('close', () => {
    it('is a no-op when no context exists', () => {
      const handlers = createWsRelayHandlers(pattern, getTargetUrl);
      const peer = makePeer('cl1');
      handlers.close(peer);
    });

    it('closes the container WS and cleans up', () => {
      mockContainerManagerGet.mockReturnValue({ name: 'w1', status: 'running' });
      const handlers = createWsRelayHandlers(pattern, getTargetUrl);
      const peer = makePeer('cl2', '/ws/desktop/c1');
      handlers.open(peer);
      handlers.close(peer);
      expect(mockWsClose).toHaveBeenCalled();
    });
  });

  describe('error', () => {
    it('is a no-op when no context exists', () => {
      const handlers = createWsRelayHandlers(pattern, getTargetUrl);
      const peer = makePeer('e1');
      handlers.error(peer);
    });

    it('closes the container WS and cleans up', () => {
      mockContainerManagerGet.mockReturnValue({ name: 'w1', status: 'running' });
      const handlers = createWsRelayHandlers(pattern, getTargetUrl);
      const peer = makePeer('e2', '/ws/desktop/c1');
      handlers.open(peer);
      handlers.error(peer);
      expect(mockWsClose).toHaveBeenCalled();
    });
  });
});
