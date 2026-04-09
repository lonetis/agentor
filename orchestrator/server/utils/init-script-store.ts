import { nanoid } from 'nanoid';
import { JsonStore } from './json-store';
import type { BuiltInInitScript } from './built-in-content';

export interface InitScript {
  id: string;
  name: string;
  content: string;
  builtIn: boolean;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

export class InitScriptStore extends JsonStore<string, InitScript> {
  constructor(dataDir: string) {
    super(dataDir, 'init-scripts.json', (s) => s.id);
    useLogger().info(`[init-scripts] store initialized (${this.items.size} scripts loaded)`);
  }

  override list(): InitScript[] {
    return super.list().sort((a, b) => {
      if (a.builtIn !== b.builtIn) return a.builtIn ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  async create(data: { name: string; content: string; userId: string }): Promise<InitScript> {
    if (!data.name?.trim()) throw new Error('name is required');
    const now = new Date().toISOString();
    const script: InitScript = {
      id: nanoid(12),
      name: data.name,
      content: data.content,
      builtIn: false,
      userId: data.userId,
      createdAt: now,
      updatedAt: now,
    };
    this.items.set(script.id, script);
    await this.persist();
    useLogger().info(`[init-scripts] created '${script.name}' (${script.id}) for user ${data.userId}`);
    return script;
  }

  async update(id: string, data: { name?: string; content?: string }): Promise<InitScript> {
    const existing = this.items.get(id);
    if (!existing) throw new Error(`Init script not found: ${id}`);
    if (existing.builtIn) {
      useLogger().warn(`[init-scripts] rejected update to built-in script '${existing.name}' (${id})`);
      throw new Error('Cannot modify built-in init scripts');
    }
    const updated: InitScript = {
      ...existing,
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.content !== undefined ? { content: data.content } : {}),
      updatedAt: new Date().toISOString(),
    };
    this.items.set(id, updated);
    await this.persist();
    useLogger().info(`[init-scripts] updated '${updated.name}' (${id})`);
    return updated;
  }

  async delete(id: string): Promise<void> {
    const existing = this.items.get(id);
    if (!existing) throw new Error(`Init script not found: ${id}`);
    if (existing.builtIn) {
      useLogger().warn(`[init-scripts] rejected deletion of built-in script '${existing.name}' (${id})`);
      throw new Error('Cannot delete built-in init scripts');
    }
    this.items.delete(id);
    await this.persist();
    useLogger().info(`[init-scripts] deleted '${existing.name}' (${id})`);
  }

  async seedBuiltIns(items: BuiltInInitScript[]): Promise<void> {
    let changed = false;
    const now = new Date().toISOString();
    const incomingIds = new Set(items.map((i) => i.id));

    // Remove stale built-in entries no longer present in source files
    for (const [id, entry] of this.items) {
      if (entry.builtIn && !incomingIds.has(id)) {
        useLogger().info(`[init-scripts] removed stale built-in '${entry.name}' (${id})`);
        this.items.delete(id);
        changed = true;
      }
    }

    let added = 0;
    let updated = 0;
    for (const item of items) {
      const existing = this.items.get(item.id);
      if (!existing) {
        this.items.set(item.id, {
          id: item.id,
          name: item.name,
          content: item.content,
          builtIn: true,
          userId: null,
          createdAt: now,
          updatedAt: now,
        });
        changed = true;
        added++;
      } else if (existing.content !== item.content || existing.name !== item.name) {
        this.items.set(item.id, {
          ...existing,
          name: item.name,
          content: item.content,
          userId: null,
          updatedAt: now,
        });
        changed = true;
        updated++;
      }
    }
    if (changed) await this.persist();
    useLogger().info(`[init-scripts] seeded built-ins: ${items.length} total, ${added} added, ${updated} updated`);
  }
}
