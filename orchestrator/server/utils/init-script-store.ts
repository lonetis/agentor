import { nanoid } from 'nanoid';
import { BuiltInAndUserStore } from './built-in-and-user-store';
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

export class InitScriptStore extends BuiltInAndUserStore<InitScript, BuiltInInitScript> {
  constructor(dataDir: string) {
    super(dataDir, 'init-scripts.json', 'init-script');
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
    await this.setItem(data.userId, script);
    useLogger().info(`[init-script] created '${script.name}' (${script.id}) for user ${data.userId}`);
    return script;
  }

  update(id: string, data: { name?: string; content?: string }): Promise<InitScript> {
    return this.updateUserItem(id, data);
  }

  protected override snapshotBuiltIn(item: BuiltInInitScript, now: string): InitScript {
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
