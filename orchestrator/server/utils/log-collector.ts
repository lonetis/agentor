import { hostname } from 'node:os';
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

export interface AttachOptions {
  // When true, only logs after now are captured. When false (default), all
  // logs since container start are captured. Use sinceNow=true on orchestrator
  // startup to avoid re-ingesting historical entries already on disk.
  sinceNow?: boolean;
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

  // Attach to the orchestrator's own container so framework/runtime stdout
  // (Nuxt, Nitro, Vite, console.warn outside useLogger, unhandled errors) is
  // captured alongside intentional useLogger() output. Source is 'orchestrator'.
  async attachSelf(): Promise<void> {
    try {
      const id = hostname();
      const container = this.docker.getContainer(id);
      const info = await container.inspect();
      const name = (info.Name || '').replace(/^\//, '') || id;
      await this.attach(name, info.Id, 'orchestrator', undefined, { sinceNow: true });
    } catch {
      // Not running in Docker or container not visible — skip silently.
    }
  }

  async init(): Promise<void> {
    // Attach to all running managed containers (workers + traefik). Use
    // sinceNow so an orchestrator restart does not replay historical lines
    // that were already written to disk during the previous lifetime.
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
      await this.attach(name, info.Id, source, displayName, { sinceNow: true });
    }
  }

  async attach(
    containerName: string,
    containerId: string,
    source: LogSource,
    displayName?: string,
    options: AttachOptions = {},
  ): Promise<void> {
    if (this.attached.has(containerId)) return;

    try {
      const container = this.docker.getContainer(containerId);
      const logsOpts: { follow: true; stdout: true; stderr: true; timestamps: true; since?: number } = {
        follow: true,
        stdout: true,
        stderr: true,
        timestamps: true,
      };
      if (options.sinceNow) {
        logsOpts.since = Math.floor(Date.now() / 1000);
      }
      const stream = await container.logs(logsOpts);

      const containerInfo = await container.inspect();
      const isTty = containerInfo.Config?.Tty ?? false;

      const ingest = (line: string, levelOverride?: LogLevel) => {
        const entry = this.parseLine(line, source, containerName, displayName);
        if (!entry) return;
        if (levelOverride) entry.level = levelOverride;
        if (!shouldLog(entry.level, this.config.logLevel)) return;
        // Orchestrator self-capture writes to the orchestrator log file so
        // it sits alongside useLogger() entries. Worker/traefik entries go
        // to the containers log.
        const category: 'orchestrator' | 'containers' = source === 'orchestrator' ? 'orchestrator' : 'containers';
        this.logStore.append(entry, category);
        this.broadcaster.broadcast(entry);
      };

      const makeLineHandler = (levelOverride?: LogLevel) => {
        let buffer = '';
        return (chunk: Buffer) => {
          buffer += chunk.toString('utf-8');
          // Split on either \r\n (TTY mode) or bare \n. A trailing \r on its
          // own line was previously breaking the timestamp regex's $ anchor.
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.trim()) continue;
            ingest(line, levelOverride);
          }
        };
      };

      let destroy: () => void;

      if (isTty) {
        const onData = makeLineHandler();
        (stream as NodeJS.ReadableStream).on('data', onData);
        destroy = () => {
          try {
            (stream as NodeJS.ReadableStream).removeAllListeners();
            const s = stream as NodeJS.ReadableStream & { destroy?: () => void };
            if (typeof s.destroy === 'function') s.destroy();
          } catch {}
        };
      } else {
        // Non-TTY streams are 8-byte-framed multiplexed stdout/stderr. Each
        // demuxed side gets its own buffer so partial lines from one stream
        // never get glued onto the other.
        const { PassThrough } = await import('node:stream');
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        this.docker.modem.demuxStream(stream, stdout, stderr);
        stdout.on('data', makeLineHandler());
        stderr.on('data', makeLineHandler('error'));
        destroy = () => {
          try {
            stdout.removeAllListeners();
            stderr.removeAllListeners();
            stdout.destroy();
            stderr.destroy();
            const s = stream as NodeJS.ReadableStream & { destroy?: () => void };
            if (typeof s.destroy === 'function') s.destroy();
          } catch {}
        };
      }

      this.attached.set(containerId, {
        stream: stream as NodeJS.ReadableStream,
        source,
        containerName,
        displayName,
        destroy,
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
    // Docker timestamp format: 2026-03-11T14:30:00.123456789Z <message>
    let timestamp: string;
    let message: string;

    // Trim a trailing \r defensively in case any caller bypassed the splitter.
    const clean = line.endsWith('\r') ? line.slice(0, -1) : line;

    const tsMatch = clean.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z?)\s+(.*)$/);
    if (tsMatch) {
      timestamp = tsMatch[1]!;
      // Normalize to ISO with millisecond precision.
      if (timestamp.length > 24) {
        timestamp = timestamp.slice(0, 23) + 'Z';
      } else if (!timestamp.endsWith('Z')) {
        timestamp = timestamp + 'Z';
      }
      message = tsMatch[2]!;
    } else {
      timestamp = new Date().toISOString();
      message = clean;
    }

    if (!message.trim()) return null;

    const level = this.detectLevel(message);

    const entry: LogEntry = {
      timestamp,
      level,
      source,
      sourceId: containerName,
      message: message.trim(),
    };
    if (displayName) entry.sourceName = displayName;
    return entry;
  }

  private detectLevel(message: string): LogLevel {
    const lower = message.toLowerCase();
    if (lower.includes('[error]') || lower.includes('error:') || lower.startsWith('err ') || lower.includes(' err ')) return 'error';
    if (lower.includes('[warn]') || lower.includes('warning:') || lower.includes(' warn ') || lower.startsWith('warn ')) return 'warn';
    if (lower.includes('[debug]') || lower.includes('debug:') || lower.startsWith('debug ')) return 'debug';
    return 'info';
  }
}
