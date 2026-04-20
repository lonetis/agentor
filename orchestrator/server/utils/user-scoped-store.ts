import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * JSON store partitioned per user. Each user's items live in their own file at
 * `<dataDir>/users/<userId>/<filename>`. On init, scans `<dataDir>/users/*` and
 * loads every matching file into an in-memory `Map<userId, Map<K, V>>`. Writes
 * are serialized per user (each user has its own save queue).
 *
 * Subclasses expose typed `create`/`update`/`delete` methods that call the
 * protected `setItem` / `deleteItem` / `removeWhere` helpers.
 */
export class UserScopedJsonStore<K, V> {
  protected items = new Map<string, Map<K, V>>();
  protected dataDir: string;
  protected filename: string;
  protected keyFn: (item: V) => K;
  private saveQueues = new Map<string, Promise<void>>();

  constructor(dataDir: string, filename: string, keyFn: (item: V) => K) {
    this.dataDir = dataDir;
    this.filename = filename;
    this.keyFn = keyFn;
  }

  async init(): Promise<void> {
    const usersDir = join(this.dataDir, 'users');
    let userIds: string[] = [];
    try {
      userIds = await readdir(usersDir);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    await Promise.all(
      userIds
        .filter((userId) => !userId.startsWith('.'))
        .map((userId) => this.loadUser(userId)),
    );
  }

  /** Load (or reload) a single user's file. Useful after a user dir is created
   * mid-run by some other subsystem. */
  async loadUser(userId: string): Promise<void> {
    const filePath = this.filePathForUser(userId);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      useLogger().error(`[user-scoped-store] failed to load ${filePath}: ${err instanceof Error ? err.message : err}`);
      throw err;
    }
    const parsed = JSON.parse(raw) as V[];
    const map = new Map<K, V>();
    for (const item of parsed) map.set(this.keyFn(item), item);
    if (map.size > 0) this.items.set(userId, map);
  }

  /** Flat list of every item across every user. */
  list(): V[] {
    const out: V[] = [];
    for (const map of this.items.values()) {
      for (const v of map.values()) out.push(v);
    }
    return out;
  }

  /** User ids that currently have at least one item in this store. Cheaper
   * than iterating `listWithOwners()` when the caller only needs the key set. */
  listUserIds(): string[] {
    return Array.from(this.items.keys());
  }

  listForUser(userId: string): V[] {
    return Array.from(this.items.get(userId)?.values() ?? []);
  }

  get(userId: string, key: K): V | undefined {
    return this.items.get(userId)?.get(key);
  }

  has(userId: string, key: K): boolean {
    return this.items.get(userId)?.has(key) ?? false;
  }

  /** Find the first item across all users matching a predicate, along with its owner. */
  findWithOwner(predicate: (item: V) => boolean): { userId: string; item: V } | undefined {
    for (const [userId, map] of this.items) {
      for (const item of map.values()) {
        if (predicate(item)) return { userId, item };
      }
    }
    return undefined;
  }

  /** Flat `[(userId, item)]` pairs across every user. */
  listWithOwners(): Array<{ userId: string; item: V }> {
    const out: Array<{ userId: string; item: V }> = [];
    for (const [userId, map] of this.items) {
      for (const item of map.values()) out.push({ userId, item });
    }
    return out;
  }

  protected async setItem(userId: string, item: V): Promise<void> {
    let map = this.items.get(userId);
    if (!map) {
      map = new Map<K, V>();
      this.items.set(userId, map);
    }
    map.set(this.keyFn(item), item);
    await this.persistUser(userId);
  }

  protected async deleteItem(userId: string, key: K): Promise<boolean> {
    const map = this.items.get(userId);
    if (!map || !map.has(key)) return false;
    map.delete(key);
    if (map.size === 0) this.items.delete(userId);
    await this.persistUser(userId);
    return true;
  }

  protected async removeWhere(predicate: (item: V) => boolean): Promise<number> {
    let count = 0;
    const dirty = new Set<string>();
    for (const [userId, map] of this.items) {
      const toRemove: K[] = [];
      for (const [key, item] of map) {
        if (predicate(item)) toRemove.push(key);
      }
      for (const key of toRemove) map.delete(key);
      if (toRemove.length > 0) {
        dirty.add(userId);
        count += toRemove.length;
        if (map.size === 0) this.items.delete(userId);
      }
    }
    for (const userId of dirty) await this.persistUser(userId);
    return count;
  }

  /** Remove every item for a user and delete their file. Called by the orphan
   * sweeper (user deletion) and similar admin paths. */
  async removeForUser(userId: string): Promise<number> {
    const map = this.items.get(userId);
    const count = map?.size ?? 0;
    this.items.delete(userId);
    try {
      await rm(this.filePathForUser(userId), { force: true });
    } catch {
      // best effort — the containing dir may already be gone
    }
    return count;
  }

  private filePathForUser(userId: string): string {
    return join(this.dataDir, 'users', userId, this.filename);
  }

  /** Serialize writes per user so concurrent `setItem` calls do not clobber
   * each other on disk. */
  protected persistUser(userId: string): Promise<void> {
    const prev = this.saveQueues.get(userId) ?? Promise.resolve();
    const next = prev.then(() => this.writeUser(userId));
    this.saveQueues.set(userId, next.catch(() => {}));
    return next;
  }

  private async writeUser(userId: string): Promise<void> {
    const filePath = this.filePathForUser(userId);
    const items = Array.from(this.items.get(userId)?.values() ?? []);
    try {
      if (items.length === 0) {
        await rm(filePath, { force: true });
        return;
      }
      await mkdir(join(this.dataDir, 'users', userId), { recursive: true });
      await writeFile(filePath, JSON.stringify(items, null, 2));
    } catch (err) {
      useLogger().error(`[user-scoped-store] failed to save ${filePath}: ${err instanceof Error ? err.message : err}`);
      throw err;
    }
  }
}
