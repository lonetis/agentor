import type { LogEntry } from '../../shared/types';

interface LogPeer {
  send(data: string): void;
}

export class LogBroadcaster {
  private peers: Set<LogPeer> = new Set();

  addPeer(peer: LogPeer): void {
    this.peers.add(peer);
  }

  removePeer(peer: LogPeer): void {
    this.peers.delete(peer);
  }

  broadcast(entry: LogEntry): void {
    if (this.peers.size === 0) return;
    const data = JSON.stringify(entry);
    for (const peer of this.peers) {
      try {
        peer.send(data);
      } catch {
        this.peers.delete(peer);
      }
    }
  }
}
