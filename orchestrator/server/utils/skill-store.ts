import { nanoid } from 'nanoid';
import { JsonStore } from './json-store';
import type { BuiltInSkill } from './built-in-content';

export interface Skill {
  id: string;
  name: string;
  content: string;
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export class SkillStore extends JsonStore<string, Skill> {
  constructor(dataDir: string) {
    super(dataDir, 'skills.json', (s) => s.id);
  }

  override list(): Skill[] {
    return super.list().sort((a, b) => {
      if (a.builtIn !== b.builtIn) return a.builtIn ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  async create(data: { name: string; content: string }): Promise<Skill> {
    const now = new Date().toISOString();
    const skill: Skill = {
      id: nanoid(12),
      name: data.name,
      content: data.content,
      builtIn: false,
      createdAt: now,
      updatedAt: now,
    };
    this.items.set(skill.id, skill);
    await this.persist();
    return skill;
  }

  async update(id: string, data: { name?: string; content?: string }): Promise<Skill> {
    const existing = this.items.get(id);
    if (!existing) throw new Error(`Skill not found: ${id}`);
    if (existing.builtIn) throw new Error('Cannot modify built-in skills');
    const updated: Skill = {
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
    if (!existing) throw new Error(`Skill not found: ${id}`);
    if (existing.builtIn) throw new Error('Cannot delete built-in skills');
    this.items.delete(id);
    await this.persist();
  }

  async seedBuiltIns(items: BuiltInSkill[]): Promise<void> {
    let changed = false;
    const now = new Date().toISOString();
    const incomingIds = new Set(items.map((i) => i.id));

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
