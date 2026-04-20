import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      for (const item of JSON.parse(raw) as V[]) {
        this.items.set(this.keyFn(item), item);
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      useLogger().error(`[defaults-store] failed to load ${this.filePath}: ${err instanceof Error ? err.message : err}`);
      throw err;
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
      await writeFile(this.filePath, JSON.stringify(this.list(), null, 2));
    } catch (err) {
      useLogger().error(`[defaults-store] failed to save ${this.filePath}: ${err instanceof Error ? err.message : err}`);
      throw err;
    }
  }
}
