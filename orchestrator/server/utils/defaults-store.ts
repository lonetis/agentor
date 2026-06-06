import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Single-file JSON store for platform-seeded (built-in) resources at
 * `<DATA_DIR>/defaults/<filename>`. Write-only from `seed()` — never mutated
 * by user-facing APIs. */
export class DefaultsStore<V> {
  protected items = new Map<string, V>();
  private filePath: string;
  protected keyFn: (item: V) => string;

  constructor(dataDir: string, filename: string, keyFn: (item: V) => string) {
    this.filePath = join(dataDir, 'defaults', filename);
    this.keyFn = keyFn;
  }

  async init(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf-8');
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      useLogger().error(`[defaults-store] failed to load ${this.filePath}: ${err instanceof Error ? err.message : err}`);
      throw err;
    }
    try {
      for (const item of JSON.parse(raw) as V[]) {
        this.items.set(this.keyFn(item), item);
      }
    } catch (err: unknown) {
      // Corrupt defaults file (e.g. truncated write). Harmless to start empty —
      // `seedBuiltIns()` overwrites the defaults store on every startup anyway,
      // so quarantine (log + skip) rather than crash the whole boot.
      useLogger().error(`[defaults-store] corrupt ${this.filePath} — starting empty (re-seeded on startup): ${err instanceof Error ? err.message : err}`);
    }
  }

  list(): V[] {
    return Array.from(this.items.values());
  }

  get(id: string): V | undefined {
    return this.items.get(id);
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  /** Replace the stored defaults with the given items, persisting to disk. */
  async replace(items: V[]): Promise<void> {
    this.items.clear();
    for (const item of items) this.items.set(this.keyFn(item), item);
    await this.persist();
  }

  protected async persist(): Promise<void> {
    try {
      // Self-sufficient: ensure the defaults dir exists rather than relying on a
      // prior `ensureDefaultsDir()` having run (matches `JsonStore.persist`).
      await mkdir(dirname(this.filePath), { recursive: true });
      // Atomic write — temp file + rename, so a hard kill mid-write can't leave a
      // truncated defaults file that crashes the next boot's parse.
      const tmpPath = `${this.filePath}.tmp.${process.pid}`;
      await writeFile(tmpPath, JSON.stringify(this.list(), null, 2));
      await rename(tmpPath, this.filePath);
    } catch (err) {
      useLogger().error(`[defaults-store] failed to save ${this.filePath}: ${err instanceof Error ? err.message : err}`);
      throw err;
    }
  }
}
