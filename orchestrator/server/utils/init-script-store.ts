import { nanoid } from 'nanoid';
import { JsonStore } from './json-store';
import type { BuiltInInitScript } from './built-in-content';

export interface InitScript {
  id: string;
  name: string;
  content: string;
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export class InitScriptStore extends JsonStore<string, InitScript> {
  constructor(dataDir: string) {
    super(dataDir, 'init-scripts.json', (s) => s.id);
  }

  override list(): InitScript[] {
    return super.list().sort((a, b) => {
      if (a.builtIn !== b.builtIn) return a.builtIn ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  async create(data: { name: string; content: string }): Promise<InitScript> {
    if (!data.name?.trim()) throw new Error('name is required');
    const now = new Date().toISOString();
    const script: InitScript = {
      id: nanoid(12),
      name: data.name,
      content: data.content,
      builtIn: false,
      createdAt: now,
      updatedAt: now,
    };
    this.items.set(script.id, script);
    await this.persist();
    return script;
  }

  async update(id: string, data: { name?: string; content?: string }): Promise<InitScript> {
    const existing = this.items.get(id);
    if (!existing) throw new Error(`Init script not found: ${id}`);
    if (existing.builtIn) throw new Error('Cannot modify built-in init scripts');
    const updated: InitScript = {
      ...existing,
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.content !== undefined ? { content: data.content } : {}),
      updatedAt: new Date().toISOString(),
    };
    this.items.set(id, updated);
    await this.persist();
    return updated;
  }

  async delete(id: string): Promise<void> {
    const existing = this.items.get(id);
    if (!existing) throw new Error(`Init script not found: ${id}`);
    if (existing.builtIn) throw new Error('Cannot delete built-in init scripts');
    this.items.delete(id);
    await this.persist();
  }

  async seedBuiltIns(items: BuiltInInitScript[]): Promise<void> {
    let changed = false;
    const now = new Date().toISOString();
    const incomingIds = new Set(items.map((i) => i.id));

    // Remove stale built-in entries no longer present in source files
    for (const [id, entry] of this.items) {
      if (entry.builtIn && !incomingIds.has(id)) {
        this.items.delete(id);
        changed = true;
      }
    }

    for (const item of items) {
      const existing = this.items.get(item.id);
      if (!existing) {
        this.items.set(item.id, {
          id: item.id,
          name: item.name,
          content: item.content,
          builtIn: true,
          createdAt: now,
          updatedAt: now,
        });
        changed = true;
      } else if (existing.content !== item.content || existing.name !== item.name) {
        this.items.set(item.id, {
          ...existing,
          name: item.name,
          content: item.content,
          updatedAt: now,
        });
        changed = true;
      }
    }
    if (changed) await this.persist();
  }
}
