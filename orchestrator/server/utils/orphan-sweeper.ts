import { getAuthDb } from './auth';
import type { UserEnvVarStore } from './user-env-store';
import type { UserCredentialManager } from './user-credentials';
import type { UsageChecker } from './usage-checker';
import type { WorkerStore } from './worker-store';
import type { PortMappingStore } from './port-mapping-store';
import type { DomainMappingStore } from './domain-mapping-store';
import type { EnvironmentStore } from './environments';
import type { CapabilityStore } from './capability-store';
import type { InstructionStore } from './instruction-store';
import type { InitScriptStore } from './init-script-store';

/** Remove per-user data whose owning user has been deleted from the auth DB.
 * Called once at startup and on a 10-minute interval so orphaned per-user
 * records (env vars, credentials, usage, workers, mappings, environments,
 * capabilities, instructions, init scripts) eventually go away after an admin
 * deletes a user. No middleware — avoids any risk of interfering with
 * better-auth's body parsing on the delete-user endpoint. */
export class OrphanSweeper {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private envStore: UserEnvVarStore,
    private credMgr: UserCredentialManager,
    private usage: UsageChecker,
    private workerStore: WorkerStore,
    private portStore: PortMappingStore,
    private domainStore: DomainMappingStore,
    private environmentStore: EnvironmentStore,
    private capabilityStore: CapabilityStore,
    private instructionStore: InstructionStore,
    private initScriptStore: InitScriptStore,
  ) {}

  start(intervalMs = 10 * 60 * 1000): void {
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

    // Collect every user id that has any per-user state on disk. Scanning all
    // of the stores (env vars, workers, mappings, environments, etc.) ensures
    // we clean up even if a user was created but never saved env vars.
    const candidates = new Set<string>();
    for (const entry of this.envStore.list()) candidates.add(entry.userId);
    for (const store of [
      this.workerStore,
      this.portStore,
      this.domainStore,
      this.environmentStore,
      this.capabilityStore,
      this.instructionStore,
      this.initScriptStore,
    ]) {
      for (const userId of store.listUserIds()) candidates.add(userId);
    }

    let removed = 0;
    for (const userId of candidates) {
      if (existingIds.has(userId)) continue;
      await this.envStore.delete(userId).catch(() => {});
      await this.workerStore.removeForUser(userId).catch(() => {});
      await this.portStore.removeForUser(userId).catch(() => {});
      await this.domainStore.removeForUser(userId).catch(() => {});
      await this.environmentStore.removeForUser(userId).catch(() => {});
      await this.capabilityStore.removeForUser(userId).catch(() => {});
      await this.instructionStore.removeForUser(userId).catch(() => {});
      await this.initScriptStore.removeForUser(userId).catch(() => {});
      await this.usage.forgetUser(userId).catch(() => {});
      // Removing the user's top-level dir cleans up any remaining files
      // (workspaces/, agents/, credentials/) that the stores don't manage.
      await this.credMgr.removeUserData(userId).catch(() => {});
      removed++;
    }
    if (removed > 0) {
      useLogger().info(`[orphan-sweeper] cleaned up ${removed} orphaned per-user record(s)`);
    }
  }
}
