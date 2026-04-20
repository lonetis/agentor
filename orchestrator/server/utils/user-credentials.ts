import { chown, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { StorageManager } from './storage';
import type { CredentialInfo } from '../../shared/types';

/** Files expected to exist in each user's credentials directory. The `fileName`
 * inside the user's on-disk directory, and the `containerPath` where workers
 * expect the bind-mounted file. These container paths match what
 * `worker/entrypoint.sh` (phase 0a) symlinks into each agent's config dir. */
export interface AgentCredentialMapping {
  agentId: string;
  fileName: string;
  containerPath: string;
}

export const AGENT_CREDENTIAL_MAPPINGS: AgentCredentialMapping[] = [
  { agentId: 'claude', fileName: 'claude.json', containerPath: '/home/agent/.agent-creds/claude.json' },
  { agentId: 'codex', fileName: 'codex.json', containerPath: '/home/agent/.agent-creds/codex.json' },
  { agentId: 'gemini', fileName: 'gemini.json', containerPath: '/home/agent/.agent-creds/gemini.json' },
];

const AGENT_UID = 1000;
const AGENT_GID = 1000;

/** Manages per-user OAuth credential files stored under
 * `<DATA_DIR>/users/<userId>/credentials/{claude,codex,gemini}.json` and
 * bind-mounted into that user's workers. */
export class UserCredentialManager {
  private storage: StorageManager;
  /** Per-process cache of user IDs whose credential directory + files have
   * already been ensured this run. Skips the mkdir/stat/writeFile/chown
   * syscalls on every subsequent worker create for the same user. */
  private seededUsers = new Set<string>();

  constructor(storage: StorageManager) {
    this.storage = storage;
  }

  /** Create the user's credentials directory and seed each agent's file as `{}`
   * when missing. Cached per-userId after first success. */
  async ensureUserDir(userId: string): Promise<void> {
    if (this.seededUsers.has(userId)) return;
    await this.storage.ensureUserDir(userId);
    const dir = this.credentialsDir(userId);
    await Promise.all(
      AGENT_CREDENTIAL_MAPPINGS.map(async (mapping) => {
        const filePath = join(dir, mapping.fileName);
        try {
          await stat(filePath);
        } catch {
          await writeFile(filePath, '{}', { mode: 0o600 });
          try {
            await chown(filePath, AGENT_UID, AGENT_GID);
          } catch {
            // Best effort — ownership only matters in directory mode. In volume
            // mode the entrypoint's chown handles it.
          }
        }
      }),
    );
    this.seededUsers.add(userId);
  }

  /** Build the bind strings mapping each of this user's credential files to the
   * expected path inside a worker container. Returns an empty array when the
   * StorageManager cannot resolve `dataHostPath` — callers should treat this as
   * "no creds shared". */
  getBindMountsForUser(userId: string): string[] {
    if (!this.storage.dataHostPath) return [];
    const hostDir = join(this.storage.getUserHostDir(userId), 'credentials');
    return AGENT_CREDENTIAL_MAPPINGS.map(
      (m) => `${join(hostDir, m.fileName)}:${m.containerPath}`,
    );
  }

  /** Returns true when the user's credential file contains more than `{}`. */
  async getStatusForUser(userId: string, fileName: string): Promise<boolean> {
    try {
      const content = await readFile(this.filePath(userId, fileName), 'utf-8');
      return content.trim().length > 2;
    } catch {
      return false;
    }
  }

  /** Reset (truncate to `{}`) a single credential file. */
  async reset(userId: string, fileName: string): Promise<void> {
    const mapping = AGENT_CREDENTIAL_MAPPINGS.find((m) => m.fileName === fileName);
    if (!mapping) throw new Error(`Unknown credential file: ${fileName}`);
    await this.ensureUserDir(userId);
    await writeFile(this.filePath(userId, fileName), '{}', { mode: 0o600 });
    try {
      await chown(this.filePath(userId, fileName), AGENT_UID, AGENT_GID);
    } catch {
      // See ensureUserDir — best effort.
    }
    useLogger().info(`[user-credentials] reset ${fileName} for user ${userId}`);
  }

  /** Return the per-user status for every known agent credential mapping. */
  async statusList(userId: string): Promise<CredentialInfo[]> {
    return Promise.all(
      AGENT_CREDENTIAL_MAPPINGS.map(async (m) => ({
        agentId: m.agentId,
        fileName: m.fileName,
        configured: await this.getStatusForUser(userId, m.fileName),
      })),
    );
  }

  /** Remove the user's entire data directory (credentials + anything else).
   * Also forgets the user from the ensureUserDir cache. */
  async removeUserData(userId: string): Promise<void> {
    this.seededUsers.delete(userId);
    await this.storage.removeUserDir(userId);
    useLogger().info(`[user-credentials] removed data directory for user ${userId}`);
  }

  /** Absolute path to the user's credentials directory, inside the container. */
  credentialsDir(userId: string): string {
    return join(this.storage.getUserDir(userId), 'credentials');
  }

  /** Absolute path to a specific credential file, inside the container. */
  filePath(userId: string, fileName: string): string {
    return join(this.credentialsDir(userId), fileName);
  }
}
