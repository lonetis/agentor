import Docker from 'dockerode';
import type { LogStore } from './log-store';
import type { LogBroadcaster } from './log-broadcaster';
import type { Config } from './config';
import type { LogLevel, LogSource, LogEntry } from '../../shared/types';
import { shouldLog } from './log-levels';

interface AttachedStream {
  stream: NodeJS.ReadableStream;
  source: LogSource;
  containerName: string;
  displayName?: string;
  destroy: () => void;
}

export class LogCollector {
  private docker: Docker;
  private logStore: LogStore;
  private broadcaster: LogBroadcaster;
  private config: Config;
  private attached: Map<string, AttachedStream> = new Map();

  constructor(config: Config, logStore: LogStore, broadcaster: LogBroadcaster) {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
    this.logStore = logStore;
    this.broadcaster = broadcaster;
    this.config = config;
  }

  async init(): Promise<void> {
    // Attach to all running managed containers
    const containers = await this.docker.listContainers({
      filters: { label: ['agentor.managed'] },
    });

    for (const info of containers) {
      const name = (info.Names[0] || '').replace(/^\//, '');
      const labelValue = info.Labels['agentor.managed'] || '';

      let source: LogSource;
      if (labelValue === 'traefik') source = 'traefik';
      else source = 'worker';

      const displayName = info.Labels['agentor.display-name'] || undefined;
      await this.attach(name, info.Id, source, displayName);
    }
  }

  async attach(containerName: string, containerId: string, source: LogSource, displayName?: string): Promise<void> {
    // Don't double-attach
    if (this.attached.has(containerId)) return;

    try {
      const container = this.docker.getContainer(containerId);
      const stream = await container.logs({
        follow: true,
        stdout: true,
        stderr: true,
        timestamps: true,
        since: Math.floor(Date.now() / 1000),
      });

      let buffer = '';

      const onData = (chunk: Buffer) => {
        buffer += chunk.toString('utf-8');
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          const entry = this.parseLine(line, source, containerName, displayName);
          if (entry && shouldLog(entry.level, this.config.logLevel)) {
            this.logStore.append(entry, 'containers');
            this.broadcaster.broadcast(entry);
          }
        }
      };

      // Docker log streams can be multiplexed (non-TTY) or raw (TTY)
      // For TTY containers, data comes as-is; for non-TTY, each frame has an 8-byte header
      const containerInfo = await container.inspect();
      const isTty = containerInfo.Config?.Tty ?? false;

      if (isTty) {
        (stream as NodeJS.ReadableStream).on('data', onData);
      } else {
        // Demux the stream
        const { PassThrough } = await import('node:stream');
        const stdout = new PassThrough();
        const stderr = new PassThrough();

        this.docker.modem.demuxStream(stream, stdout, stderr);

        stdout.on('data', onData);
        stderr.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf-8');
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            const entry = this.parseLine(line, source, containerName, displayName);
            if (entry) {
              entry.level = 'error';
              if (shouldLog(entry.level, this.config.logLevel)) {
                this.logStore.append(entry, 'containers');
                this.broadcaster.broadcast(entry);
              }
            }
          }
        });
      }

      this.attached.set(containerId, {
        stream: stream as NodeJS.ReadableStream,
        source,
        containerName,
        displayName,
        destroy: () => {
          try {
            (stream as NodeJS.ReadableStream).removeAllListeners();
            if (typeof (stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy === 'function') {
              (stream as NodeJS.ReadableStream & { destroy: () => void }).destroy();
            }
          } catch {}
        },
      });
    } catch {}
  }

  detach(containerId: string): void {
    const attached = this.attached.get(containerId);
    if (attached) {
      attached.destroy();
      this.attached.delete(containerId);
    }
  }

  detachAll(): void {
    for (const [id] of this.attached) {
      this.detach(id);
    }
  }

  private parseLine(line: string, source: LogSource, containerName: string, displayName?: string): LogEntry | null {
    // Docker timestamps format: 2026-03-11T14:30:00.123456789Z <message>
    // Or lines might have 8-byte header prefix already stripped
    let timestamp: string;
    let message: string;

    const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z?)\s+(.*)$/);
    if (tsMatch) {
      timestamp = tsMatch[1]!;
      // Normalize to ISO with milliseconds
      if (timestamp.length > 24) {
        timestamp = timestamp.slice(0, 23) + 'Z';
      }
      message = tsMatch[2]!;
    } else {
      timestamp = new Date().toISOString();
      message = line;
    }

    if (!message.trim()) return null;

    const level = this.detectLevel(message);

    return {
      timestamp,
      level,
      source,
      sourceId: containerName,
      sourceName: displayName,
      message: message.trim(),
    };
  }

  private detectLevel(message: string): LogLevel {
    const lower = message.toLowerCase();
    if (lower.includes('[error]') || lower.includes('error:') || lower.startsWith('err ') || lower.includes(' err ')) return 'error';
    if (lower.includes('[warn]') || lower.includes('warning:') || lower.includes(' warn ') || lower.startsWith('warn ')) return 'warn';
    if (lower.includes('[debug]') || lower.includes('debug:') || lower.startsWith('debug ')) return 'debug';
    return 'info';
  }
}
