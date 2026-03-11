import type { Config } from './config';
import type { LogStore } from './log-store';
import type { LogBroadcaster } from './log-broadcaster';
import type { LogLevel, LogEntry } from '../../shared/types';
import { shouldLog } from './log-levels';

export class Logger {
  private config: Config;
  private logStore: LogStore;
  private broadcaster: LogBroadcaster;
  private buffer: LogEntry[] = [];
  private ready = false;

  constructor(config: Config, logStore: LogStore, broadcaster: LogBroadcaster) {
    this.config = config;
    this.logStore = logStore;
    this.broadcaster = broadcaster;
  }

  setReady(): void {
    this.ready = true;
    for (const entry of this.buffer) {
      this.logStore.append(entry, 'orchestrator');
      this.broadcaster.broadcast(entry);
    }
    this.buffer = [];
  }

  debug(message: string): void {
    this.log('debug', message);
  }

  info(message: string): void {
    this.log('info', message);
  }

  warn(message: string): void {
    this.log('warn', message);
  }

  error(message: string): void {
    this.log('error', message);
  }

  private log(level: LogLevel, message: string): void {
    if (!shouldLog(level, this.config.logLevel)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      source: 'orchestrator',
      message,
    };

    if (!this.ready) {
      this.buffer.push(entry);
      return;
    }

    this.logStore.append(entry, 'orchestrator');
    this.broadcaster.broadcast(entry);
  }
}
