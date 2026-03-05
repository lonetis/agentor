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

/**
 * Parse the `name` field from YAML frontmatter in a SKILL.md string.
 * Returns undefined if no frontmatter or no name field found.
 */
export function parseSkillName(content: string): string | undefined {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match?.[1]) return undefined;
  const nameMatch = match[1].match(/^name:\s*(.+)$/m);
  return nameMatch?.[1]?.trim();
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

  async create(data: { content: string }): Promise<Skill> {
    const name = parseSkillName(data.content);
    if (!name) throw new Error('Skill content must include YAML frontmatter with a name field');
    const now = new Date().toISOString();
    const skill: Skill = {
      id: nanoid(12),
      name,
      content: data.content,
      builtIn: false,
      createdAt: now,
      updatedAt: now,
    };
    this.items.set(skill.id, skill);
    await this.persist();
    return skill;
  }

  async update(id: string, data: { content: string }): Promise<Skill> {
    const existing = this.items.get(id);
    if (!existing) throw new Error(`Skill not found: ${id}`);
    if (existing.builtIn) throw new Error('Cannot modify built-in skills');
    const name = parseSkillName(data.content);
    if (!name) throw new Error('Skill content must include YAML frontmatter with a name field');
    const updated: Skill = {
      ...existing,
      name,
      content: data.content,
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
    for (const item of items) {
      const name = parseSkillName(item.content) ?? item.id;
      const existing = this.items.get(item.id);
      if (!existing) {
        this.items.set(item.id, {
          id: item.id,
          name,
          content: item.content,
          builtIn: true,
          createdAt: now,
          updatedAt: now,
        });
        changed = true;
      } else if (existing.content !== item.content) {
        this.items.set(item.id, {
          ...existing,
          name,
          content: item.content,
          updatedAt: now,
        });
        changed = true;
      }
    }
    if (changed) await this.persist();
  }
}
