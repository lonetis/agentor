import { DefaultsStore } from './defaults-store';
import { UserScopedJsonStore } from './user-scoped-store';

export interface BuiltInAndUserItem {
  id: string;
  name: string;
  builtIn: boolean;
  /** `null` for built-in entries, the owner's id for user entries. */
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Base class for stores that hold platform-seeded "built-in" entries (persisted
 * to `<DATA_DIR>/defaults/<filename>`) alongside user-created entries (persisted
 * per-user to `<DATA_DIR>/users/<userId>/<filename>`). `list()` merges both;
 * `update()` and `delete()` refuse to mutate built-ins. */
export abstract class BuiltInAndUserStore<V extends BuiltInAndUserItem, B extends { id: string; name: string }>
  extends UserScopedJsonStore<string, V> {
  protected defaults: DefaultsStore<V>;
  protected readonly label: string;

  constructor(dataDir: string, filename: string, label: string) {
    super(dataDir, filename, (v) => v.id);
    this.defaults = new DefaultsStore<V>(dataDir, filename, (v) => v.id);
    this.label = label;
  }

  override async init(): Promise<void> {
    await this.defaults.init();
    await super.init();
  }

  override list(): V[] {
    const merged: V[] = [...this.defaults.list(), ...super.list()];
    return merged.sort((a, b) => {
      if (a.builtIn !== b.builtIn) return a.builtIn ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  getById(id: string): V | undefined {
    return this.defaults.get(id) ?? this.findWithOwner((v) => v.id === id)?.item;
  }

  findById(id: string): { userId: string | null; item: V } | undefined {
    const builtIn = this.defaults.get(id);
    if (builtIn) return { userId: null, item: builtIn };
    return this.findWithOwner((v) => v.id === id);
  }

  /** Merge `patch` onto an existing user entry. Subclasses narrow the patch
   * type at their public API layer. */
  protected async updateUserItem(id: string, patch: Partial<V>): Promise<V> {
    if (this.defaults.has(id)) {
      useLogger().warn(`[${this.label}] update rejected — built-in (${id})`);
      throw new Error(`Cannot modify built-in ${this.label}s`);
    }
    const owner = this.findWithOwner((v) => v.id === id);
    if (!owner) throw new Error(`${this.label} not found: ${id}`);
    const updated: V = {
      ...owner.item,
      ...patch,
      id: owner.item.id,
      builtIn: owner.item.builtIn,
      userId: owner.item.userId,
      createdAt: owner.item.createdAt,
      updatedAt: new Date().toISOString(),
    };
    await this.setItem(owner.userId, updated);
    useLogger().info(`[${this.label}] updated '${updated.name}' (${id})`);
    return updated;
  }

  async delete(id: string): Promise<void> {
    if (this.defaults.has(id)) {
      useLogger().warn(`[${this.label}] delete rejected — built-in (${id})`);
      throw new Error(`Cannot delete built-in ${this.label}s`);
    }
    const owner = this.findWithOwner((v) => v.id === id);
    if (!owner) throw new Error(`${this.label} not found: ${id}`);
    await this.deleteItem(owner.userId, id);
    useLogger().info(`[${this.label}] deleted '${owner.item.name}' (${id})`);
  }

  async seedBuiltIns(items: B[]): Promise<void> {
    const now = new Date().toISOString();
    const snapshot = items.map((item) => this.snapshotBuiltIn(item, now));
    await this.defaults.replace(snapshot);
    useLogger().info(`[${this.label}] seeded ${snapshot.length} built-in(s)`);
  }

  /** Build a defaults-store record from a source built-in definition. */
  protected abstract snapshotBuiltIn(item: B, now: string): V;
}
