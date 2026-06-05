import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { UserEnvVars, UserEnvVarsInput, UserEnvVar } from '../../shared/types';

export const USER_ENV_KEY_RE = /^[A-Z_][A-Z0-9_]*$/;

/** The env vars the orchestrator (or the worker entrypoint) injects into every
 * worker container. This is the *complete* set of orchestrator-provided env a
 * worker actually receives — nothing else from the orchestrator's own process
 * env (BETTER_AUTH_*, DASHBOARD_*, ACME_*, BASE_DOMAINS, LOG_*, …) is ever passed
 * to a worker. It is the single source of truth behind both the reserved-key
 * guard (users may not override these) and the read-only "provided by the
 * orchestrator" list surfaced in the worker Environment editor
 * (`GET /api/worker-env-vars`). */
export const WORKER_SYSTEM_ENV_VARS: { name: string; description: string }[] = [
  { name: 'ENVIRONMENT', description: 'Environment config JSON — network mode, allowed domains, Docker, setup script, exposed APIs' },
  { name: 'CAPABILITIES', description: 'Enabled capability documents (JSON array)' },
  { name: 'INSTRUCTIONS', description: 'Enabled instruction documents (JSON array)' },
  { name: 'WORKER', description: 'Worker identity & config JSON — id, display name, repos, init script, git identity' },
  { name: 'ORCHESTRATOR_URL', description: 'Base URL of the orchestrator API (used by worker-self calls)' },
  { name: 'WORKER_CONTAINER_NAME', description: "This worker's Docker container name" },
  { name: 'EXPOSE_PORT_MAPPINGS', description: 'Whether the worker-self port-mapping API is exposed (from Expose APIs)' },
  { name: 'EXPOSE_DOMAIN_MAPPINGS', description: 'Whether the worker-self domain-mapping API is exposed (from Expose APIs)' },
  { name: 'EXPOSE_USAGE', description: 'Whether the worker-self usage API is exposed (from Expose APIs)' },
];

/** Reserved env var names that must not appear in a user's env vars (they are
 * injected by the orchestrator or the entrypoint and would collide). The
 * orchestrator-injected names come straight from `WORKER_SYSTEM_ENV_VARS`; the
 * remaining three are OS-level vars the entrypoint relies on. */
const RESERVED_KEYS = new Set<string>([
  ...WORKER_SYSTEM_ENV_VARS.map((v) => v.name),
  'HOME',
  'PATH',
  'USER',
]);

export function zeroUserEnvVars(userId: string): UserEnvVars {
  return {
    userId,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    envVars: [],
  };
}

/** Look up a single env var's value by name (empty string if unset). */
export function getUserEnvVar(env: UserEnvVars, key: string): string {
  return env.envVars.find((e) => e.key === key)?.value ?? '';
}

const FILENAME = 'env-vars.json';

/** Per-user env vars, persisted as a single JSON object at
 * `<DATA_DIR>/users/<userId>/env-vars.json`. The file carries the owner `userId`
 * (matching the directory name) like every other user-scoped resource.
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
      const parsed = JSON.parse(raw) as Partial<UserEnvVars>;
      const now = new Date().toISOString();
      // Coerce to the current shape: tolerate files written before env-vars
      // became a uniform `envVars` list (older shapes have no `envVars`, so they
      // load as an empty list rather than crashing the renderer). `userId` is
      // always taken from the directory name, not the file.
      this.items.set(userId, {
        userId,
        createdAt: parsed.createdAt ?? now,
        updatedAt: parsed.updatedAt ?? now,
        envVars: Array.isArray(parsed.envVars) ? parsed.envVars : [],
      });
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
    const envVars = input.envVars !== undefined
      ? sanitizeEnvVars(input.envVars)
      : existing.envVars;

    const merged: UserEnvVars = {
      userId,
      createdAt: existing.createdAt && existing.createdAt !== new Date(0).toISOString()
        ? existing.createdAt
        : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      envVars,
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
      // Persist the full record (incl. `userId`) like every user-scoped resource.
      await writeFile(filePath, JSON.stringify(entry, null, 2));
    } catch (err) {
      useLogger().error(`[user-env-store] failed to save ${filePath}: ${err instanceof Error ? err.message : err}`);
      throw err;
    }
  }
}

/** Validate + dedupe a user's env var list. All env vars (predefined + custom)
 * go through the same checks: key format `[A-Z_][A-Z0-9_]*`, not a reserved name,
 * no duplicates. Empty-keyed entries are dropped. */
function sanitizeEnvVars(input: UserEnvVar[]): UserEnvVar[] {
  if (!Array.isArray(input)) throw new Error('envVars must be an array');
  const out: UserEnvVar[] = [];
  const seen = new Set<string>();
  for (const entry of input) {
    if (!entry || typeof entry.key !== 'string' || typeof entry.value !== 'string') continue;
    const key = entry.key.trim();
    if (!key) continue;
    if (!USER_ENV_KEY_RE.test(key)) {
      throw new Error(`Invalid env var name: "${key}". Must match ${USER_ENV_KEY_RE}.`);
    }
    if (RESERVED_KEYS.has(key)) {
      throw new Error(`"${key}" is reserved and cannot be set as an env var.`);
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
 * Order follows the stored list; later entries shadow earlier ones on key clash. */
export function renderUserEnvVars(env: UserEnvVars): string[] {
  const merged = new Map<string, string>();
  for (const { key, value } of env.envVars) {
    if (value) merged.set(key, value);
  }
  return [...merged.entries()].map(([k, v]) => `${k}=${v}`);
}
