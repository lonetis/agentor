import { createWriteStream, existsSync, mkdirSync, statSync, renameSync, unlinkSync, createReadStream } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { WriteStream } from 'node:fs';
import type { Config } from './config';
import type { LogEntry, LogLevel, LogSource } from '../../shared/types';
import { shouldLog } from './log-levels';

export interface LogQueryOptions {
  sources?: LogSource[];
  sourceIds?: string[];
  levels?: LogLevel[];
  since?: string;
  until?: string;
  limit?: number;
  search?: string;
}

export class LogStore {
  private logsDir: string;
  private maxSize: number;
  private maxFiles: number;
  private logLevel: LogLevel;
  private streams: Map<string, WriteStream> = new Map();
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(config: Config) {
    this.logsDir = join(config.dataDir, 'logs');
    this.maxSize = config.logMaxSize;
    this.maxFiles = config.logMaxFiles;
    this.logLevel = config.logLevel;
  }

  async init(): Promise<void> {
    if (!existsSync(this.logsDir)) {
      mkdirSync(this.logsDir, { recursive: true });
    }
  }

  append(entry: LogEntry, file: 'orchestrator' | 'containers'): void {
    if (!shouldLog(entry.level, this.logLevel)) return;

    const line = JSON.stringify(entry) + '\n';
    this.writeQueue = this.writeQueue.then(() => this.writeLine(file, line)).catch(() => {});
  }

  private async writeLine(file: string, line: string): Promise<void> {
    const filePath = join(this.logsDir, `${file}.log`);

    // Check rotation before writing
    if (existsSync(filePath)) {
      try {
        const stat = statSync(filePath);
        if (stat.size >= this.maxSize) {
          await this.rotate(file);
        }
      } catch {}
    }

    const stream = this.getStream(file);
    await new Promise<void>((resolve, reject) => {
      stream.write(line, (err) => (err ? reject(err) : resolve()));
    });
  }

  private getStream(file: string): WriteStream {
    let stream = this.streams.get(file);
    if (stream && !stream.destroyed) return stream;

    stream = createWriteStream(join(this.logsDir, `${file}.log`), { flags: 'a' });
    this.streams.set(file, stream);
    return stream;
  }

  private async rotate(file: string): Promise<void> {
    // Close existing stream
    const existing = this.streams.get(file);
    if (existing) {
      existing.end();
      this.streams.delete(file);
    }

    const base = join(this.logsDir, `${file}`);

    // Delete oldest
    const oldest = `${base}.${this.maxFiles}.log`;
    if (existsSync(oldest)) unlinkSync(oldest);

    // Shift files up
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const from = `${base}.${i}.log`;
      const to = `${base}.${i + 1}.log`;
      if (existsSync(from)) renameSync(from, to);
    }

    // Rename current to .1
    const current = `${base}.log`;
    if (existsSync(current)) renameSync(current, `${base}.1.log`);
  }

  async query(options: LogQueryOptions = {}): Promise<{ entries: LogEntry[]; hasMore: boolean }> {
    const limit = Math.min(options.limit || 500, 5000);
    const entries: LogEntry[] = [];

    // Read files newest-first: current, then .1, .2, etc.
    const files: string[] = [join(this.logsDir, 'orchestrator.log'), join(this.logsDir, 'containers.log')];

    for (let i = 1; i <= this.maxFiles; i++) {
      files.push(join(this.logsDir, `orchestrator.${i}.log`));
      files.push(join(this.logsDir, `containers.${i}.log`));
    }

    for (const filePath of files) {
      if (!existsSync(filePath)) continue;

      const fileEntries = await this.readLogFile(filePath, options);
      entries.push(...fileEntries);

      if (entries.length > limit) break;
    }

    // Sort by timestamp descending (newest first)
    entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    const hasMore = entries.length > limit;
    return { entries: entries.slice(0, limit), hasMore };
  }

  private async readLogFile(filePath: string, options: LogQueryOptions): Promise<LogEntry[]> {
    const entries: LogEntry[] = [];

    try {
      const rl = createInterface({
        input: createReadStream(filePath),
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as LogEntry;
          if (this.matchesFilter(entry, options)) {
            entries.push(entry);
          }
        } catch {}
      }
    } catch {}

    return entries;
  }

  private matchesFilter(entry: LogEntry, options: LogQueryOptions): boolean {
    if (options.sources && options.sources.length > 0 && !options.sources.includes(entry.source)) return false;
    if (options.sourceIds && options.sourceIds.length > 0 && entry.sourceId && !options.sourceIds.includes(entry.sourceId)) return false;
    if (options.levels && options.levels.length > 0 && !options.levels.includes(entry.level)) return false;
    // `since` is inclusive (>=) and `until` is exclusive (<). The asymmetry
    // makes pagination work cleanly: paginating older with `until = oldest`
    // never re-returns the boundary entry, and paginating newer with
    // `since = newest` never re-returns it either.
    if (options.since && entry.timestamp < options.since) return false;
    if (options.until && entry.timestamp >= options.until) return false;
    if (options.search && !entry.message.toLowerCase().includes(options.search.toLowerCase())) return false;
    return true;
  }

  async clear(): Promise<void> {
    // Close all streams
    for (const [, stream] of this.streams) {
      stream.end();
    }
    this.streams.clear();

    try {
      const files = await readdir(this.logsDir);
      for (const file of files) {
        if (file.endsWith('.log')) {
          unlinkSync(join(this.logsDir, file));
        }
      }
    } catch {}
  }

  async getLogSources(): Promise<{ sourceId: string; sourceName?: string; source: LogSource }[]> {
    const sources = new Map<string, { sourceId: string; sourceName?: string; source: LogSource }>();

    const containerLog = join(this.logsDir, 'containers.log');
    if (existsSync(containerLog)) {
      try {
        const content = await readFile(containerLog, 'utf-8');
        for (const line of content.split('\n')) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line) as LogEntry;
            if (entry.sourceId && !sources.has(entry.sourceId)) {
              sources.set(entry.sourceId, { sourceId: entry.sourceId, sourceName: entry.sourceName, source: entry.source });
            }
          } catch {}
        }
      } catch {}
    }

    return Array.from(sources.values());
  }

  destroy(): void {
    for (const [, stream] of this.streams) {
      stream.end();
    }
    this.streams.clear();
  }
}
