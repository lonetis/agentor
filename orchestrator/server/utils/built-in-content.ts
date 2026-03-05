export interface BuiltInSkill {
  id: string;
  content: string;
}

export interface BuiltInAgentsMdEntry {
  id: string;
  name: string;
  content: string;
}

/**
 * Parse the entry name from the first `# Heading` in markdown content.
 */
function parseEntryName(content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? 'Untitled';
}

/**
 * Load all built-in skills from server assets (server/built-in/skills/*.md).
 * Each file's basename (without extension) is used as the skill ID.
 */
export async function loadBuiltInSkills(): Promise<BuiltInSkill[]> {
  const storage = useStorage('assets:built-in/skills');
  const keys = await storage.getKeys();
  const skills: BuiltInSkill[] = [];
  for (const key of keys) {
    if (!key.endsWith('.md')) continue;
    const content = await storage.getItem(key) as string;
    if (!content) continue;
    const id = key.replace(/\.md$/, '');
    skills.push({ id, content });
  }
  return skills;
}

/**
 * Load all built-in AGENTS.md entries from server assets (server/built-in/agents-md/*.md).
 * Each file's basename (without extension) is used as the entry ID.
 * The name is parsed from the first `# Heading` in the content.
 */
export async function loadBuiltInAgentsMd(): Promise<BuiltInAgentsMdEntry[]> {
  const storage = useStorage('assets:built-in/agents-md');
  const keys = await storage.getKeys();
  const entries: BuiltInAgentsMdEntry[] = [];
  for (const key of keys) {
    if (!key.endsWith('.md')) continue;
    const content = await storage.getItem(key) as string;
    if (!content) continue;
    const id = key.replace(/\.md$/, '');
    const name = parseEntryName(content);
    entries.push({ id, name, content });
  }
  return entries;
}
