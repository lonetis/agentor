import { nanoid } from 'nanoid';
import { BuiltInAndUserStore } from './built-in-and-user-store';
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

export class CapabilityStore extends BuiltInAndUserStore<Capability, BuiltInCapability> {
  constructor(dataDir: string) {
    super(dataDir, 'capabilities.json', 'capability');
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
    await this.setItem(data.userId, capability);
    useLogger().info(`[capability] created '${capability.name}' (${capability.id}) for user ${data.userId}`);
    return capability;
  }

  update(id: string, data: { name?: string; content?: string }): Promise<Capability> {
    return this.updateUserItem(id, data);
  }

  protected override snapshotBuiltIn(item: BuiltInCapability, now: string): Capability {
    return {
      id: item.id,
      name: item.name,
      content: item.content,
      builtIn: true,
      userId: null,
      createdAt: now,
      updatedAt: now,
    };
  }
}
