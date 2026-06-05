import { createHash } from 'node:crypto';

/** Fixed namespace UUID for Agentor built-in resource ids.
 *
 * Built-in resources are re-seeded on every orchestrator startup, so their ids
 * must be STABLE across restarts — a random v4 per boot would orphan every
 * stored reference (a worker's `environmentId`, an environment's
 * `enabledCapabilityIds`/`enabledInstructionIds`). A deterministic RFC 4122 v5
 * uuid derived from the resource type + slug keeps the id constant across
 * restarts and installs while still being a real UUID. */
const BUILTIN_NAMESPACE = '6f3b9e8a-7c41-4d2e-9a1b-2c5d6e7f8a90';

function uuidv5(name: string, namespace: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const bytes = createHash('sha1').update(ns).update(name, 'utf8').digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** Stable UUID for a built-in resource, derived from its type + slug (filename).
 * Deterministic, so the same built-in keeps the same id across every restart. */
export function builtInId(type: string, slug: string): string {
  return uuidv5(`${type}:${slug}`, BUILTIN_NAMESPACE);
}

export interface BuiltInCapability {
  id: string;
  name: string;
  content: string;
}

export interface BuiltInInstruction {
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
  enabledCapabilityIds: string[] | null;
  enabledInstructionIds: string[] | null;
}

function toText(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (raw instanceof Uint8Array) return new TextDecoder().decode(raw);
  return String(raw);
}

/**
 * Load all built-in capabilities from server assets (server/built-in/capabilities/*.md).
 * Each file's basename (without extension) is the capability name; its id is a
 * stable UUID derived from that slug via `builtInId()`.
 */
export async function loadBuiltInCapabilities(): Promise<BuiltInCapability[]> {
  const storage = useStorage('assets:builtin-capabilities');
  const keys = await storage.getKeys();
  const capabilities: BuiltInCapability[] = [];
  for (const key of keys) {
    if (!key.endsWith('.md')) continue;
    const raw = await storage.getItem(key);
    if (!raw) continue;
    const content = toText(raw);
    const slug = key.replace(/\.md$/, '');
    capabilities.push({ id: builtInId('capability', slug), name: slug, content });
  }
  return capabilities;
}

/**
 * Load all built-in instructions from server assets (server/built-in/instructions/*.md).
 * The filename (without extension) is the name; the id is a stable UUID derived from it via `builtInId()`.
 */
export async function loadBuiltInInstructions(): Promise<BuiltInInstruction[]> {
  const storage = useStorage('assets:builtin-instructions');
  const keys = await storage.getKeys();
  const entries: BuiltInInstruction[] = [];
  for (const key of keys) {
    if (!key.endsWith('.md')) continue;
    const raw = await storage.getItem(key);
    if (!raw) continue;
    const content = toText(raw);
    const slug = key.replace(/\.md$/, '');
    entries.push({ id: builtInId('instruction', slug), name: slug, content });
  }
  return entries;
}

/**
 * Load all built-in init scripts from server assets (server/built-in/init-scripts/*.sh).
 * The filename (without extension) is the display name; the id is a stable UUID derived from it via `builtInId()`.
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
    const slug = key.replace(/\.sh$/, '');
    scripts.push({ id: builtInId('init-script', slug), name: slug, content: content.trim() });
  }
  return scripts;
}

/**
 * Load all built-in environments from server assets (server/built-in/environments/*.json).
 * The filename (without extension) is the name; the id is a stable UUID derived from it via `builtInId()`.
 */
export async function loadBuiltInEnvironments(): Promise<BuiltInEnvironment[]> {
  const storage = useStorage('assets:builtin-environments');
  const keys = await storage.getKeys();
  const environments: BuiltInEnvironment[] = [];
  for (const key of keys) {
    if (!key.endsWith('.json')) continue;
    const raw = await storage.getItem(key);
    if (!raw) continue;
    const slug = key.replace(/\.json$/, '');
    const data = typeof raw === 'object' && !(raw instanceof Uint8Array) ? raw : JSON.parse(toText(raw));
    environments.push({ id: builtInId('environment', slug), name: slug, ...data });
  }
  return environments;
}
