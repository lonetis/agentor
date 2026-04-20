import { nanoid } from 'nanoid';
import { BuiltInAndUserStore } from './built-in-and-user-store';
import type { BuiltInInstruction } from './built-in-content';

export interface Instruction {
  id: string;
  name: string;
  content: string;
  builtIn: boolean;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

export class InstructionStore extends BuiltInAndUserStore<Instruction, BuiltInInstruction> {
  constructor(dataDir: string) {
    super(dataDir, 'instructions.json', 'instruction');
  }

  async create(data: { name: string; content: string; userId: string }): Promise<Instruction> {
    const now = new Date().toISOString();
    const entry: Instruction = {
      id: nanoid(12),
      name: data.name,
      content: data.content,
      builtIn: false,
      userId: data.userId,
      createdAt: now,
      updatedAt: now,
    };
    await this.setItem(data.userId, entry);
    useLogger().info(`[instruction] created '${entry.name}' (${entry.id}) for user ${data.userId}`);
    return entry;
  }

  update(id: string, data: { name?: string; content?: string }): Promise<Instruction> {
    return this.updateUserItem(id, data);
  }

  protected override snapshotBuiltIn(item: BuiltInInstruction, now: string): Instruction {
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
