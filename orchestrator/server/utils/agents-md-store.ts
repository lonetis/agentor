import { nanoid } from 'nanoid';
import { JsonStore } from './json-store';
import type { BuiltInAgentsMdEntry } from './built-in-content';

export interface AgentsMdEntry {
  id: string;
  name: string;
  content: string;
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export class AgentsMdStore extends JsonStore<string, AgentsMdEntry> {
  constructor(dataDir: string) {
    super(dataDir, 'agents-md.json', (i) => i.id);
  }

  override list(): AgentsMdEntry[] {
    return super.list().sort((a, b) => {
      if (a.builtIn !== b.builtIn) return a.builtIn ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  async create(data: { name: string; content: string }): Promise<AgentsMdEntry> {
    const now = new Date().toISOString();
    const entry: AgentsMdEntry = {
      id: nanoid(12),
      name: data.name,
      content: data.content,
      builtIn: false,
      createdAt: now,
      updatedAt: now,
    };
    this.items.set(entry.id, entry);
    await this.persist();
    return entry;
  }

  async update(id: string, data: { name?: string; content?: string }): Promise<AgentsMdEntry> {
    const existing = this.items.get(id);
    if (!existing) throw new Error(`AGENTS.md entry not found: ${id}`);
    if (existing.builtIn) throw new Error('Cannot modify built-in AGENTS.md entries');
    const updated: AgentsMdEntry = {
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
    if (!existing) throw new Error(`AGENTS.md entry not found: ${id}`);
    if (existing.builtIn) throw new Error('Cannot delete built-in AGENTS.md entries');
    this.items.delete(id);
    await this.persist();
  }

  async seedBuiltIns(items: BuiltInAgentsMdEntry[]): Promise<void> {
    let changed = false;
    const now = new Date().toISOString();
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
