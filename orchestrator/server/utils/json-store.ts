import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export class JsonStore<K, V> {
  protected items = new Map<K, V>();
  private filePath: string;
  private saveQueue = Promise.resolve();
  private keyFn: (item: V) => K;

  constructor(dataDir: string, filename: string, keyFn: (item: V) => K) {
    this.filePath = join(dataDir, filename);
    this.keyFn = keyFn;
  }

  async init(): Promise<void> {
    const logger = useLogger();
    try {
      const data = await readFile(this.filePath, 'utf-8');
      for (const item of JSON.parse(data) as V[]) {
        this.items.set(this.keyFn(item), item);
      }
      logger.debug(`[json-store] loaded ${this.items.size} items from ${this.filePath}`);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.debug(`[json-store] no file at ${this.filePath} — starting empty`);
        return;
      }
      logger.error(`[json-store] failed to load ${this.filePath}: ${err instanceof Error ? err.message : err}`);
      throw err;
    }
  }

  list(): V[] {
    return Array.from(this.items.values());
  }

  get(key: K): V | undefined {
    return this.items.get(key);
  }

  has(key: K): boolean {
    return this.items.has(key);
  }

  protected async removeWhere(predicate: (item: V) => boolean): Promise<number> {
    const toRemove: K[] = [];
    for (const [key, item] of this.items) {
      if (predicate(item)) toRemove.push(key);
    }
    for (const key of toRemove) this.items.delete(key);
    if (toRemove.length > 0) await this.persist();
    return toRemove.length;
  }

  protected persist(): Promise<void> {
    this.saveQueue = this.saveQueue.then(async () => {
      try {
        await mkdir(dirname(this.filePath), { recursive: true });
        await writeFile(this.filePath, JSON.stringify(this.list(), null, 2));
      } catch (err) {
        useLogger().error(`[json-store] failed to save ${this.filePath}: ${err instanceof Error ? err.message : err}`);
        throw err;
      }
    });
    return this.saveQueue;
  }
}
