import { JsonStore } from './json-store';
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

export class UserEnvVarStore extends JsonStore<string, UserEnvVars> {
  constructor(dataDir: string) {
    super(dataDir, 'user-env-vars.json', (e) => e.userId);
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
    await this.persist();
    useLogger().debug(`[user-env-store] upserted env vars for user ${userId}`);
    return merged;
  }

  async delete(userId: string): Promise<void> {
    if (this.items.delete(userId)) {
      await this.persist();
      useLogger().info(`[user-env-store] removed env vars for user ${userId}`);
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
