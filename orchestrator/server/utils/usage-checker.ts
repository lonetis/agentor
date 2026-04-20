import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config } from './config';
import type { AgentUsageInfo, AgentUsageStatus, AgentAuthType } from '../../shared/types';
import type { UserEnvVarStore } from './user-env-store';
import type { UserCredentialManager } from './user-credentials';

const POLL_INTERVAL_MS = 300_000;
const USAGE_FILENAME = 'usage.json';

interface AgentState {
  info: AgentUsageInfo;
  lastFetchTime: number;
}

/** Shape persisted to each user's `users/<userId>/usage.json` — a flat map of
 * agentId → state. The `userId` is implied by the file path. */
type PersistedUserUsage = Record<string, { info: AgentUsageInfo; lastFetchTime: number; backoffUntil: number }>;

const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CODEX_TOKEN_ENDPOINT = 'https://auth.openai.com/oauth/token';

interface ClaudeCredFile {
  claudeAiOauth?: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
  };
}

interface CodexCredFile {
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    account_id?: string;
  };
  last_refresh?: string;
}

interface GeminiCredFile {
  access_token?: string;
  refresh_token?: string;
  expiry_date?: number;
  id_token?: string;
}

/** Usage checker, per-user. Each user's OAuth credentials (stored under
 * `<DATA_DIR>/users/<userId>/credentials/`) are polled independently. Callers
 * of the public API always pass a `userId` — admins still only see their own
 * usage (ownership is enforced at the route layer). */
export class UsageChecker {
  private config: Config;
  private userEnvStore?: UserEnvVarStore;
  private credMgr?: UserCredentialManager;
  private userStates = new Map<string, Map<string, AgentState>>();
  private rateLimitBackoff = new Map<string, number>(); // key: `${userId}:${agentId}`
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private fetchQueue: Promise<void> = Promise.resolve();
  private saveQueues = new Map<string, Promise<void>>();
  /** Serialized payload most recently written to each user's usage.json, so we
   * can skip the writeFile() when nothing changed between 5-minute polls. */
  private lastWritten = new Map<string, string>();

  constructor(config: Config) {
    this.config = config;
  }

  setUserEnvStore(store: UserEnvVarStore): void {
    this.userEnvStore = store;
  }

  setCredentialManager(mgr: UserCredentialManager): void {
    this.credMgr = mgr;
  }

  async init(): Promise<void> {
    await this.loadState();

    // Kick off a background poll for every user that has OAuth creds. If none
    // do (fresh install) we still start the interval so new users are picked
    // up on the next tick.
    await this.fetchAll();
    this.pollInterval = setInterval(() => {
      this.fetchAll().catch((err) => {
        useLogger().error(`[usage-checker] poll error: ${err instanceof Error ? err.message : err}`);
      });
    }, POLL_INTERVAL_MS);
  }

  async refresh(userId: string): Promise<AgentUsageStatus> {
    await this.fetchUser(userId);
    return this.getStatus(userId);
  }

  getStatus(userId: string): AgentUsageStatus {
    const agents: AgentUsageInfo[] = [];
    const map = this.userStates.get(userId);
    if (map) {
      for (const state of map.values()) {
        agents.push({
          ...state.info,
          lastFetchTime: state.lastFetchTime > 0 ? new Date(state.lastFetchTime).toISOString() : undefined,
        });
      }
    }
    return { agents };
  }

  /** Clear persisted state for a user (called on user deletion). */
  async forgetUser(userId: string): Promise<void> {
    this.userStates.delete(userId);
    for (const key of [...this.rateLimitBackoff.keys()]) {
      if (key.startsWith(`${userId}:`)) this.rateLimitBackoff.delete(key);
    }
    try {
      await rm(this.stateFilePath(userId), { force: true });
    } catch {
      // best effort — the containing dir may already be gone
    }
  }

  // ─── Polling ─────────────────────────────────────────────────

  private async candidateUserIds(): Promise<string[]> {
    // Every user in the env-var store is a candidate (they may have a Claude
    // setup token, an OAuth cred file, or both — `doFetchUser` short-circuits
    // per-agent when there's no token). Anyone we've already polled stays on
    // the list so their persisted state keeps getting refreshed across
    // restarts even if the env store entry was cleared.
    const ids = new Set<string>();
    if (this.userEnvStore) {
      for (const entry of this.userEnvStore.list()) ids.add(entry.userId);
    }
    for (const id of this.userStates.keys()) ids.add(id);
    return [...ids];
  }

  private fetchAll(): Promise<void> {
    this.fetchQueue = this.fetchQueue.then(() => this.doFetchAll()).catch(() => {});
    return this.fetchQueue;
  }

  private fetchUser(userId: string): Promise<void> {
    this.fetchQueue = this.fetchQueue.then(() => this.doFetchUser(userId)).catch(() => {});
    return this.fetchQueue;
  }

  private async doFetchAll(): Promise<void> {
    const userIds = await this.candidateUserIds();
    // Parallel per-user — each user's three agents are independent. One
    // user's slow upstream API should not block others.
    await Promise.all(userIds.map((userId) => this.doFetchUser(userId)));
  }

  private async doFetchUser(userId: string): Promise<void> {
    if (!userId) return;
    const now = Date.now();
    const existing = this.userStates.get(userId) ?? new Map<string, AgentState>();

    const agentIds = ['claude', 'codex', 'gemini'] as const;
    const fetchFns = [
      () => this.fetchClaudeUsage(userId),
      () => this.fetchCodexUsage(userId),
      () => this.fetchGeminiUsage(userId),
    ];

    const fetchers: Array<() => Promise<AgentUsageInfo>> = [];
    for (let i = 0; i < agentIds.length; i++) {
      const state = existing.get(agentIds[i]!);
      if (!state || now - state.lastFetchTime >= POLL_INTERVAL_MS) {
        fetchers.push(fetchFns[i]!);
      }
    }
    if (fetchers.length === 0) return;

    const results = await Promise.all(fetchers.map((fn) => fn()));
    for (const info of results) {
      existing.set(info.agentId, { info, lastFetchTime: now });
    }
    this.userStates.set(userId, existing);
    await this.saveUser(userId);
  }

  // ─── Persistence ────────────────────────────────────────────

  private stateFilePath(userId: string): string {
    return join(this.config.dataDir, 'users', userId, USAGE_FILENAME);
  }

  private async loadState(): Promise<void> {
    const usersDir = join(this.config.dataDir, 'users');
    let userIds: string[] = [];
    try {
      userIds = await readdir(usersDir);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      return;
    }
    const now = Date.now();
    await Promise.all(
      userIds
        .filter((userId) => !userId.startsWith('.'))
        .map((userId) => this.loadUserState(userId, now)),
    );
  }

  private async loadUserState(userId: string, now: number): Promise<void> {
    try {
      const raw = await readFile(this.stateFilePath(userId), 'utf-8');
      const data = JSON.parse(raw) as PersistedUserUsage;
      const map = new Map<string, AgentState>();
      for (const [agentId, entry] of Object.entries(data)) {
        if (entry?.info) {
          map.set(agentId, {
            info: entry.info,
            lastFetchTime: typeof entry.lastFetchTime === 'number' ? entry.lastFetchTime : 0,
          });
        }
        if (typeof entry?.backoffUntil === 'number' && entry.backoffUntil > now) {
          this.rateLimitBackoff.set(`${userId}:${agentId}`, entry.backoffUntil);
        }
      }
      if (map.size > 0) this.userStates.set(userId, map);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      useLogger().error(`[usage-checker] failed to load ${this.stateFilePath(userId)}: ${err instanceof Error ? err.message : err}`);
    }
  }

  private saveUser(userId: string): Promise<void> {
    const prev = this.saveQueues.get(userId) ?? Promise.resolve();
    const next = prev.then(() => this.writeUser(userId));
    this.saveQueues.set(userId, next.catch(() => {}));
    return next;
  }

  private async writeUser(userId: string): Promise<void> {
    const map = this.userStates.get(userId);
    const filePath = this.stateFilePath(userId);
    try {
      if (!map || map.size === 0) {
        await rm(filePath, { force: true });
        this.lastWritten.delete(userId);
        return;
      }
      const payload: PersistedUserUsage = {};
      for (const [agentId, state] of map) {
        payload[agentId] = {
          info: state.info,
          lastFetchTime: state.lastFetchTime,
          backoffUntil: this.rateLimitBackoff.get(`${userId}:${agentId}`) ?? 0,
        };
      }
      const serialized = JSON.stringify(payload);
      if (this.lastWritten.get(userId) === serialized) return;
      await mkdir(join(this.config.dataDir, 'users', userId), { recursive: true });
      await writeFile(filePath, serialized);
      this.lastWritten.set(userId, serialized);
    } catch (err) {
      useLogger().error(`[usage-checker] failed to save ${filePath}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ─── Credential file I/O ────────────────────────────────────

  private async readCredFile<T>(userId: string, fileName: string): Promise<T | null> {
    if (!this.credMgr) return null;
    try {
      const raw = await readFile(this.credMgr.filePath(userId, fileName), 'utf-8');
      const trimmed = raw.trim();
      if (trimmed.length <= 2) return null;
      return JSON.parse(trimmed) as T;
    } catch {
      return null;
    }
  }

  private detectAuthType(userId: string, agentId: string, hasOAuthFile: boolean): AgentAuthType {
    if (hasOAuthFile) return 'oauth';
    const env = this.userEnvStore?.getOrDefault(userId);
    if (agentId === 'claude' && env?.claudeCodeOauthToken) return 'oauth';
    const keyMap: Record<string, keyof NonNullable<typeof env>> = {
      claude: 'anthropicApiKey',
      codex: 'openaiApiKey',
      gemini: 'geminiApiKey',
    };
    const configKey = keyMap[agentId];
    if (env && configKey && typeof env[configKey] === 'string' && env[configKey]) return 'api-key';
    return 'none';
  }

  // ─── Claude ─────────────────────────────────────────────────

  private async fetchClaudeUsage(userId: string): Promise<AgentUsageInfo> {
    const now = new Date().toISOString();
    const cred = await this.readCredFile<ClaudeCredFile>(userId, 'claude.json');
    const envToken = this.userEnvStore?.getOrDefault(userId).claudeCodeOauthToken;
    const token = cred?.claudeAiOauth?.accessToken || envToken || '';
    const authType = this.detectAuthType(
      userId,
      'claude',
      !!(cred?.claudeAiOauth?.accessToken || envToken),
    );

    const base: AgentUsageInfo = {
      agentId: 'claude',
      displayName: 'Claude',
      authType,
      usageAvailable: false,
      windows: [],
      lastChecked: now,
    };
    if (!token) return base;

    const backoffKey = `${userId}:claude`;
    const backoffUntil = this.rateLimitBackoff.get(backoffKey);
    if (backoffUntil && Date.now() < backoffUntil) {
      base.error = `Rate limited — retrying after ${new Date(backoffUntil).toISOString()}`;
      return base;
    }

    try {
      const resp = await fetch('https://api.anthropic.com/api/oauth/usage', {
        headers: {
          Authorization: `Bearer ${token}`,
          'anthropic-beta': 'oauth-2025-04-20',
        },
      });
      if (resp.status === 429) {
        const retryAfter = resp.headers.get('retry-after');
        const delaySec = retryAfter ? parseInt(retryAfter, 10) : 600;
        const delayMs = (Number.isFinite(delaySec) && delaySec > 0 ? delaySec : 600) * 1000;
        this.rateLimitBackoff.set(backoffKey, Date.now() + delayMs);
        await this.saveUser(userId);
        base.error = `Rate limited — retry after ${delaySec}s`;
        return base;
      }
      if (this.rateLimitBackoff.delete(backoffKey)) await this.saveUser(userId);
      if (!resp.ok) {
        base.error = `HTTP ${resp.status}`;
        return base;
      }
      interface ClaudeWindow { utilization: number; resets_at: string }
      const data = (await resp.json()) as {
        five_hour?: ClaudeWindow | null;
        seven_day?: ClaudeWindow | null;
        seven_day_sonnet?: ClaudeWindow | null;
      };
      base.usageAvailable = true;
      if (data.five_hour) base.windows.push({ label: 'Session', utilization: data.five_hour.utilization, resetsAt: data.five_hour.resets_at });
      if (data.seven_day) base.windows.push({ label: 'Weekly', utilization: data.seven_day.utilization, resetsAt: data.seven_day.resets_at });
      if (data.seven_day_sonnet) base.windows.push({ label: 'Sonnet', utilization: data.seven_day_sonnet.utilization, resetsAt: data.seven_day_sonnet.resets_at });
    } catch (err: unknown) {
      base.error = err instanceof Error ? err.message : String(err);
    }
    return base;
  }

  // ─── Codex ──────────────────────────────────────────────────

  private async fetchCodexUsage(userId: string): Promise<AgentUsageInfo> {
    const now = new Date().toISOString();
    const cred = await this.readCredFile<CodexCredFile>(userId, 'codex.json');
    let token = cred?.tokens?.access_token;
    const refreshToken = cred?.tokens?.refresh_token;
    const authType = this.detectAuthType(userId, 'codex', !!token);

    const base: AgentUsageInfo = {
      agentId: 'codex',
      displayName: 'Codex',
      authType,
      usageAvailable: false,
      windows: [],
      lastChecked: now,
    };
    if (!token) return base;

    if (refreshToken && cred?.last_refresh) {
      const lastRefresh = new Date(cred.last_refresh).getTime();
      const eightDays = 8 * 24 * 60 * 60 * 1000;
      if (Date.now() - lastRefresh > eightDays) {
        try {
          token = await this.refreshCodexToken(userId, refreshToken, cred);
        } catch (err: unknown) {
          base.error = `Token refresh failed: ${err instanceof Error ? err.message : String(err)}`;
          return base;
        }
      }
    }

    const backoffKey = `${userId}:codex`;
    const backoffUntil = this.rateLimitBackoff.get(backoffKey);
    if (backoffUntil && Date.now() < backoffUntil) {
      base.error = `Rate limited — retrying after ${new Date(backoffUntil).toISOString()}`;
      return base;
    }

    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (cred?.tokens?.account_id) headers['ChatGPT-Account-Id'] = cred.tokens.account_id;
      const resp = await fetch('https://chatgpt.com/backend-api/wham/usage', { headers });
      if (resp.status === 429) {
        const retryAfter = resp.headers.get('retry-after');
        const delaySec = retryAfter ? parseInt(retryAfter, 10) : 600;
        const delayMs = (Number.isFinite(delaySec) && delaySec > 0 ? delaySec : 600) * 1000;
        this.rateLimitBackoff.set(backoffKey, Date.now() + delayMs);
        await this.saveUser(userId);
        base.error = `Rate limited — retry after ${delaySec}s`;
        return base;
      }
      if (this.rateLimitBackoff.delete(backoffKey)) await this.saveUser(userId);
      if (!resp.ok) {
        base.error = `HTTP ${resp.status}`;
        return base;
      }
      interface CodexWindow { used_percent: number; reset_at: number; limit_window_seconds: number }
      const data = (await resp.json()) as {
        plan_type?: string;
        rate_limit?: { primary_window?: CodexWindow | null; secondary_window?: CodexWindow | null };
        credits?: { has_credits?: boolean; unlimited?: boolean; balance?: string };
      };
      base.usageAvailable = true;
      if (data.plan_type) base.planType = data.plan_type;
      if (data.rate_limit?.primary_window) {
        const w = data.rate_limit.primary_window;
        base.windows.push({ label: 'Session', utilization: w.used_percent, resetsAt: new Date(w.reset_at * 1000).toISOString() });
      }
      if (data.rate_limit?.secondary_window) {
        const w = data.rate_limit.secondary_window;
        base.windows.push({ label: 'Weekly', utilization: w.used_percent, resetsAt: new Date(w.reset_at * 1000).toISOString() });
      }
      if (data.credits?.has_credits || data.credits?.unlimited) {
        const balance = parseFloat(data.credits.balance || '0');
        base.windows.push({
          label: 'Reserve',
          utilization: data.credits.unlimited ? 0 : Math.max(0, balance),
          resetsAt: null,
        });
      }
    } catch (err: unknown) {
      base.error = err instanceof Error ? err.message : String(err);
    }
    return base;
  }

  private async refreshCodexToken(userId: string, refreshToken: string, cred: CodexCredFile): Promise<string> {
    const resp = await fetch(CODEX_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CODEX_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        scope: 'openid profile email',
      }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = (await resp.json()) as { access_token: string; refresh_token?: string; id_token?: string };
    const updated: CodexCredFile = {
      ...cred,
      tokens: {
        ...cred.tokens,
        access_token: data.access_token,
        ...(data.refresh_token && { refresh_token: data.refresh_token }),
        ...(data.id_token && { id_token: data.id_token }),
      },
      last_refresh: new Date().toISOString(),
    };
    if (this.credMgr) {
      await writeFile(this.credMgr.filePath(userId, 'codex.json'), JSON.stringify(updated, null, 2));
    }
    useLogger().info(`[usage-checker] refreshed Codex OAuth token for user ${userId}`);
    return data.access_token;
  }

  // ─── Gemini ─────────────────────────────────────────────────

  private async fetchGeminiUsage(userId: string): Promise<AgentUsageInfo> {
    const now = new Date().toISOString();
    const cred = await this.readCredFile<GeminiCredFile>(userId, 'gemini.json');
    const token = cred?.access_token;
    const authType = this.detectAuthType(userId, 'gemini', !!token);

    const base: AgentUsageInfo = {
      agentId: 'gemini',
      displayName: 'Gemini',
      authType,
      usageAvailable: false,
      windows: [],
      lastChecked: now,
    };
    if (!token) return base;

    if (cred?.expiry_date && cred.expiry_date < Date.now()) {
      base.error = 'Token expired — run gemini in a worker to refresh';
      return base;
    }

    const backoffKey = `${userId}:gemini`;
    const backoffUntil = this.rateLimitBackoff.get(backoffKey);
    if (backoffUntil && Date.now() < backoffUntil) {
      base.error = `Rate limited — retrying after ${new Date(backoffUntil).toISOString()}`;
      return base;
    }

    try {
      const resp = await fetch('https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (resp.status === 429) {
        const retryAfter = resp.headers.get('retry-after');
        const delaySec = retryAfter ? parseInt(retryAfter, 10) : 600;
        const delayMs = (Number.isFinite(delaySec) && delaySec > 0 ? delaySec : 600) * 1000;
        this.rateLimitBackoff.set(backoffKey, Date.now() + delayMs);
        await this.saveUser(userId);
        base.error = `Rate limited — retry after ${delaySec}s`;
        return base;
      }
      if (this.rateLimitBackoff.delete(backoffKey)) await this.saveUser(userId);
      if (!resp.ok) {
        base.error = `HTTP ${resp.status}`;
        return base;
      }
      const data = (await resp.json()) as {
        buckets?: Array<{ modelId?: string; remainingFraction?: number; resetTime?: string; tokenType?: string }>;
      };
      base.usageAvailable = true;
      if (data.buckets && data.buckets.length > 0) {
        const families: Record<string, { lowestRemaining: number; earliestReset: string | null }> = {};
        for (const bucket of data.buckets) {
          const modelId = bucket.modelId || '';
          let family: string;
          if (modelId.includes('-pro')) family = 'Pro';
          else if (modelId.includes('-flash')) family = 'Flash';
          else family = modelId;
          if (!families[family]) families[family] = { lowestRemaining: 1, earliestReset: null };
          const f = families[family]!;
          const remaining = bucket.remainingFraction ?? 1;
          if (remaining < f.lowestRemaining) f.lowestRemaining = remaining;
          if (bucket.resetTime) {
            if (!f.earliestReset || bucket.resetTime < f.earliestReset) f.earliestReset = bucket.resetTime;
          }
        }
        const order = ['Pro', 'Flash'];
        const sorted = Object.keys(families).sort((a, b) => {
          const ai = order.indexOf(a);
          const bi = order.indexOf(b);
          return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        });
        for (const family of sorted) {
          const f = families[family]!;
          base.windows.push({ label: family, utilization: Math.round((1 - f.lowestRemaining) * 100), resetsAt: f.earliestReset });
        }
      }
    } catch (err: unknown) {
      base.error = err instanceof Error ? err.message : String(err);
    }
    return base;
  }
}
