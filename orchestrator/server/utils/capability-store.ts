import { nanoid } from 'nanoid';
import { JsonStore } from './json-store';
import type { BuiltInCapability } from './built-in-content';

export interface Capability {
  id: string;
  name: string;
  content: string;
  builtIn: boolean;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

export class CapabilityStore extends JsonStore<string, Capability> {
  constructor(dataDir: string) {
    super(dataDir, 'capabilities.json', (s) => s.id);
  }

  override list(): Capability[] {
    return super.list().sort((a, b) => {
      if (a.builtIn !== b.builtIn) return a.builtIn ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  async create(data: { name: string; content: string; userId: string }): Promise<Capability> {
    const now = new Date().toISOString();
    const capability: Capability = {
      id: nanoid(12),
      name: data.name,
      content: data.content,
      builtIn: false,
      userId: data.userId,
      createdAt: now,
      updatedAt: now,
    };
    this.items.set(capability.id, capability);
    await this.persist();
    useLogger().info(`[capabilities] created capability '${capability.name}' (${capability.id}) for user ${data.userId}`);
    return capability;
  }

  async update(id: string, data: { name?: string; content?: string }): Promise<Capability> {
    const existing = this.items.get(id);
    if (!existing) {
      useLogger().warn(`[capabilities] update failed — capability not found: ${id}`);
      throw new Error(`Capability not found: ${id}`);
    }
    if (existing.builtIn) {
      useLogger().warn(`[capabilities] update rejected — built-in capability '${existing.name}' (${id})`);
      throw new Error('Cannot modify built-in capabilities');
    }
    const updated: Capability = {
      ...existing,
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.content !== undefined ? { content: data.content } : {}),
      updatedAt: new Date().toISOString(),
    };
    this.items.set(id, updated);
    await this.persist();
    useLogger().info(`[capabilities] updated capability '${updated.name}' (${id})`);
    return updated;
  }

  async delete(id: string): Promise<void> {
    const existing = this.items.get(id);
    if (!existing) {
      useLogger().warn(`[capabilities] delete failed — capability not found: ${id}`);
      throw new Error(`Capability not found: ${id}`);
    }
    if (existing.builtIn) {
      useLogger().warn(`[capabilities] delete rejected — built-in capability '${existing.name}' (${id})`);
      throw new Error('Cannot delete built-in capabilities');
    }
    this.items.delete(id);
    await this.persist();
    useLogger().info(`[capabilities] deleted capability '${existing.name}' (${id})`);
  }

  async seedBuiltIns(items: BuiltInCapability[]): Promise<void> {
    let changed = false;
    const now = new Date().toISOString();
    const incomingIds = new Set(items.map((i) => i.id));

    for (const [id, entry] of this.items) {
      if (entry.builtIn && !incomingIds.has(id)) {
        this.items.delete(id);
        useLogger().debug(`[capabilities] removed stale built-in '${entry.name}' (${id})`);
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
          userId: null,
          createdAt: now,
          updatedAt: now,
        });
        useLogger().debug(`[capabilities] seeded built-in '${item.name}' (${item.id})`);
        changed = true;
      } else if (existing.content !== item.content || existing.name !== item.name) {
        this.items.set(item.id, {
          ...existing,
          name: item.name,
          content: item.content,
          userId: null,
          updatedAt: now,
        });
        useLogger().debug(`[capabilities] updated built-in '${item.name}' (${item.id})`);
        changed = true;
      }
    }
    if (changed) await this.persist();
    useLogger().info(`[capabilities] initialized — ${this.items.size} capability(ies) (${items.length} built-in)`);
  }
}
