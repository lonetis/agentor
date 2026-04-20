import { getAuthDb } from './auth';
import type { UserEnvVarStore } from './user-env-store';
import type { UserCredentialManager } from './user-credentials';
import type { UsageChecker } from './usage-checker';

/** Remove per-user data whose owning user has been deleted from the auth DB.
 * Called once at startup and on a 10-minute interval so orphaned env-vars
 * rows, credential directories, and usage state eventually go away after an
 * admin deletes a user. No middleware — avoids any risk of interfering with
 * better-auth's body parsing on the delete-user endpoint. */
export class OrphanSweeper {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private envStore: UserEnvVarStore,
    private credMgr: UserCredentialManager,
    private usage: UsageChecker,
  ) {}

  start(intervalMs = 10 * 60 * 1000): void {
    // Run once at startup, then on a schedule.
    this.sweep().catch((err) => {
      useLogger().error(`[orphan-sweeper] initial sweep failed: ${err instanceof Error ? err.message : err}`);
    });
    this.timer = setInterval(() => {
      this.sweep().catch((err) => {
        useLogger().error(`[orphan-sweeper] sweep failed: ${err instanceof Error ? err.message : err}`);
      });
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async sweep(): Promise<void> {
    const existingIds = new Set<string>();
    try {
      const rows = getAuthDb().prepare('SELECT id FROM user').all() as { id: string }[];
      for (const r of rows) existingIds.add(r.id);
    } catch {
      // Auth DB not ready yet — nothing to sweep.
      return;
    }

    let removed = 0;
    for (const entry of this.envStore.list()) {
      if (!existingIds.has(entry.userId)) {
        await this.envStore.delete(entry.userId).catch(() => {});
        await this.credMgr.removeUserData(entry.userId).catch(() => {});
        await this.usage.forgetUser(entry.userId).catch(() => {});
        removed++;
      }
    }
    if (removed > 0) {
      useLogger().info(`[orphan-sweeper] cleaned up ${removed} orphaned per-user record(s)`);
    }
  }
}
