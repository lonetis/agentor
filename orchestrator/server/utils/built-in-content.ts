export interface BuiltInSkill {
  id: string;
  name: string;
  content: string;
}

export interface BuiltInAgentsMdEntry {
  id: string;
  name: string;
  content: string;
}

export interface BuiltInInitScript {
  id: string;
  name: string;
  content: string;
}

export interface BuiltInEnvironment {
  id: string;
  name: string;
  cpuLimit: number;
  memoryLimit: string;
  networkMode: string;
  allowedDomains: string[];
  includePackageManagerDomains: boolean;
  dockerEnabled: boolean;
  envVars: string;
  setupScript: string;
  exposeApis: { portMappings: boolean; domainMappings: boolean; usage: boolean };
  enabledSkillIds: string[] | null;
  enabledAgentsMdIds: string[] | null;
}

function toText(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (raw instanceof Uint8Array) return new TextDecoder().decode(raw);
  return String(raw);
}

/**
 * Load all built-in skills from server assets (server/built-in/skills/*.md).
 * Each file's basename (without extension) is used as the skill ID.
 */
export async function loadBuiltInSkills(): Promise<BuiltInSkill[]> {
  const storage = useStorage('assets:builtin-skills');
  const keys = await storage.getKeys();
  const skills: BuiltInSkill[] = [];
  for (const key of keys) {
    if (!key.endsWith('.md')) continue;
    const raw = await storage.getItem(key);
    if (!raw) continue;
    const content = toText(raw);
    const id = key.replace(/\.md$/, '');
    skills.push({ id, name: id, content });
  }
  return skills;
}

/**
 * Load all built-in AGENTS.md entries from server assets (server/built-in/agents-md/*.md).
 * The filename (without extension) is both the ID and the name.
 */
export async function loadBuiltInAgentsMd(): Promise<BuiltInAgentsMdEntry[]> {
  const storage = useStorage('assets:builtin-agents-md');
  const keys = await storage.getKeys();
  const entries: BuiltInAgentsMdEntry[] = [];
  for (const key of keys) {
    if (!key.endsWith('.md')) continue;
    const raw = await storage.getItem(key);
    if (!raw) continue;
    const content = toText(raw);
    const id = key.replace(/\.md$/, '');
    entries.push({ id, name: id, content });
  }
  return entries;
}

/**
 * Load all built-in init scripts from server assets (server/built-in/init-scripts/*.sh).
 * The filename (without extension) is both the ID and the display name.
 */
export async function loadBuiltInInitScripts(): Promise<BuiltInInitScript[]> {
  const storage = useStorage('assets:builtin-init-scripts');
  const keys = await storage.getKeys();
  const scripts: BuiltInInitScript[] = [];
  for (const key of keys) {
    if (!key.endsWith('.sh')) continue;
    const raw = await storage.getItem(key);
    if (!raw) continue;
    const content = toText(raw);
    const id = key.replace(/\.sh$/, '');
    scripts.push({ id, name: id, content: content.trim() });
  }
  return scripts;
}

/**
 * Load all built-in environments from server assets (server/built-in/environments/*.json).
 * The filename (without extension) is both the ID and the name.
 */
export async function loadBuiltInEnvironments(): Promise<BuiltInEnvironment[]> {
  const storage = useStorage('assets:builtin-environments');
  const keys = await storage.getKeys();
  const environments: BuiltInEnvironment[] = [];
  for (const key of keys) {
    if (!key.endsWith('.json')) continue;
    const raw = await storage.getItem(key);
    if (!raw) continue;
    const id = key.replace(/\.json$/, '');
    const data = typeof raw === 'object' && !(raw instanceof Uint8Array) ? raw : JSON.parse(toText(raw));
    environments.push({ id, name: id, ...data });
  }
  return environments;
}
