import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { UserEnvVars, UserEnvVarsInput, UserCustomEnvVar } from '../../shared/types';

export const USER_ENV_KEY_RE = /^[A-Z_][A-Z0-9_]*$/;

/** Reserved env var names that must not appear in user customEnvVars (they are
 * injected by the orchestrator or the entrypoint and would collide). */
const RESERVED_KEYS = new Set([
  'ENVIRONMENT',
  'CAPABILITIES',
  'INSTRUCTIONS',
  'WORKER',
  'ORCHESTRATOR_URL',
  'WORKER_CONTAINER_NAME',
  'EXPOSE_PORT_MAPPINGS',
  'EXPOSE_DOMAIN_MAPPINGS',
  'EXPOSE_USAGE',
  'HOME',
  'PATH',
  'USER',
]);

export function zeroUserEnvVars(userId: string): UserEnvVars {
  return {
    userId,
    githubToken: '',
    anthropicApiKey: '',
    claudeCodeOauthToken: '',
    openaiApiKey: '',
    geminiApiKey: '',
    customEnvVars: [],
    updatedAt: new Date(0).toISOString(),
  };
}

const FILENAME = 'env-vars.json';

/** Per-user env vars, persisted as a single JSON object at
 * `<DATA_DIR>/users/<userId>/env-vars.json`. The `userId` is the directory
 * name; it is not persisted inside the file itself.
 *
 * Serialized writes per user via an in-memory save queue. */
export class UserEnvVarStore {
  private items = new Map<string, UserEnvVars>();
  private dataDir: string;
  private saveQueues = new Map<string, Promise<void>>();

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  async init(): Promise<void> {
    const usersDir = join(this.dataDir, 'users');
    let userIds: string[] = [];
    try {
      userIds = await readdir(usersDir);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    await Promise.all(
      userIds
        .filter((userId) => !userId.startsWith('.'))
        .map((userId) => this.loadUser(userId)),
    );
  }

  async loadUser(userId: string): Promise<void> {
    const filePath = this.filePath(userId);
    try {
      const raw = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Omit<UserEnvVars, 'userId'>;
      this.items.set(userId, { userId, ...parsed });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      useLogger().error(`[user-env-store] failed to load ${filePath}: ${err instanceof Error ? err.message : err}`);
      throw err;
    }
  }

  list(): UserEnvVars[] {
    return Array.from(this.items.values());
  }

  getOrDefault(userId: string): UserEnvVars {
    return this.items.get(userId) ?? zeroUserEnvVars(userId);
  }

  async upsert(userId: string, input: UserEnvVarsInput): Promise<UserEnvVars> {
    const existing = this.items.get(userId) ?? zeroUserEnvVars(userId);
    const customEnvVars = input.customEnvVars !== undefined
      ? sanitizeCustomEnvVars(input.customEnvVars)
      : existing.customEnvVars;

    const merged: UserEnvVars = {
      userId,
      githubToken: input.githubToken ?? existing.githubToken,
      anthropicApiKey: input.anthropicApiKey ?? existing.anthropicApiKey,
      claudeCodeOauthToken: input.claudeCodeOauthToken ?? existing.claudeCodeOauthToken,
      openaiApiKey: input.openaiApiKey ?? existing.openaiApiKey,
      geminiApiKey: input.geminiApiKey ?? existing.geminiApiKey,
      customEnvVars,
      updatedAt: new Date().toISOString(),
    };
    this.items.set(userId, merged);
    await this.persist(userId);
    useLogger().debug(`[user-env-store] upserted env vars for user ${userId}`);
    return merged;
  }

  async delete(userId: string): Promise<void> {
    if (!this.items.has(userId)) return;
    this.items.delete(userId);
    try {
      await rm(this.filePath(userId), { force: true });
    } catch {
      // best effort — directory may already be gone
    }
    useLogger().info(`[user-env-store] removed env vars for user ${userId}`);
  }

  private filePath(userId: string): string {
    return join(this.dataDir, 'users', userId, FILENAME);
  }

  private persist(userId: string): Promise<void> {
    const prev = this.saveQueues.get(userId) ?? Promise.resolve();
    const next = prev.then(() => this.write(userId));
    this.saveQueues.set(userId, next.catch(() => {}));
    return next;
  }

  private async write(userId: string): Promise<void> {
    const entry = this.items.get(userId);
    if (!entry) return;
    const filePath = this.filePath(userId);
    try {
      await mkdir(join(this.dataDir, 'users', userId), { recursive: true });
      // Strip `userId` — it's implied by the file location.
      const { userId: _u, ...body } = entry;
      await writeFile(filePath, JSON.stringify(body, null, 2));
    } catch (err) {
      useLogger().error(`[user-env-store] failed to save ${filePath}: ${err instanceof Error ? err.message : err}`);
      throw err;
    }
  }
}

function sanitizeCustomEnvVars(input: UserCustomEnvVar[]): UserCustomEnvVar[] {
  const out: UserCustomEnvVar[] = [];
  const seen = new Set<string>();
  for (const entry of input) {
    if (!entry || typeof entry.key !== 'string' || typeof entry.value !== 'string') continue;
    const key = entry.key.trim();
    if (!key) continue;
    if (!USER_ENV_KEY_RE.test(key)) {
      throw new Error(`Invalid env var name: "${key}". Must match ${USER_ENV_KEY_RE}.`);
    }
    if (RESERVED_KEYS.has(key)) {
      throw new Error(`"${key}" is reserved and cannot be set as a custom env var.`);
    }
    if (seen.has(key)) {
      throw new Error(`Duplicate env var name: "${key}"`);
    }
    seen.add(key);
    out.push({ key, value: entry.value });
  }
  return out;
}

/** Render user env vars as a list of `KEY=VALUE` strings, skipping empty values.
 * Well-known slots are emitted first, then customEnvVars. Later entries overwrite
 * earlier ones within the same render so customEnvVars can shadow well-known keys.
 */
export function renderUserEnvVars(env: UserEnvVars): string[] {
  const merged = new Map<string, string>();
  const slot = (key: string, value: string) => {
    if (value) merged.set(key, value);
  };
  slot('GITHUB_TOKEN', env.githubToken);
  slot('ANTHROPIC_API_KEY', env.anthropicApiKey);
  slot('CLAUDE_CODE_OAUTH_TOKEN', env.claudeCodeOauthToken);
  slot('OPENAI_API_KEY', env.openaiApiKey);
  slot('GEMINI_API_KEY', env.geminiApiKey);
  for (const { key, value } of env.customEnvVars) {
    if (value) merged.set(key, value);
  }
  return [...merged.entries()].map(([k, v]) => `${k}=${v}`);
}
