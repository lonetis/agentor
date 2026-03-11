import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config } from './config';
import type { AgentUsageInfo, AgentUsageStatus, AgentAuthType, UsageWindow } from '../../shared/types';

const CRED_DIR = '/cred';
const POLL_INTERVAL_MS = 300_000;

interface AgentState {
  info: AgentUsageInfo;
  lastFetchTime: number;
}

interface PersistedUsageState {
  agents: Record<string, { info: AgentUsageInfo; lastFetchTime: number; backoffUntil: number }>;
}

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

export class UsageChecker {
  private config: Config;
  private agentStates = new Map<string, AgentState>();
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  /** Per-agent backoff state for rate-limited endpoints (persisted to disk) */
  private rateLimitBackoff = new Map<string, number>();
  private stateFilePath: string;
  /** Serializes fetchAll() calls to prevent concurrent API requests */
  private fetchQueue: Promise<void> = Promise.resolve();

  constructor(config: Config) {
    this.config = config;
    this.stateFilePath = join(config.dataDir, 'usage.json');
  }

  async init(): Promise<void> {
    await this.loadState();
    await this.deleteLegacyFiles();

    const now = Date.now();
    const anyStale = !this.agentStates.size || [...this.agentStates.values()].some(
      (s) => now - s.lastFetchTime >= POLL_INTERVAL_MS,
    );

    if (anyStale) {
      await this.fetchAll();
    } else {
      const oldest = Math.min(...[...this.agentStates.values()].map((s) => s.lastFetchTime));
      useLogger().info(`[usage-checker] skipping initial fetch (${Math.round((now - oldest) / 1000)}s since oldest check, serving persisted data)`);
    }

    // Detect OAuth from credential files so polling starts even when the initial fetch was skipped
    const hasAnyOAuth = await this.hasOAuthCredentials();
    if (hasAnyOAuth) {
      this.pollInterval = setInterval(() => {
        this.fetchAll().catch((err) => {
          useLogger().error(`[usage-checker] poll error: ${err instanceof Error ? err.message : err}`);
        });
      }, POLL_INTERVAL_MS);
    }
  }

  async refresh(): Promise<AgentUsageStatus> {
    await this.fetchAll();
    return this.getStatus();
  }

  getStatus(): AgentUsageStatus {
    const agents = [...this.agentStates.values()].map((s) => ({
      ...s.info,
      lastFetchTime: s.lastFetchTime > 0 ? new Date(s.lastFetchTime).toISOString() : undefined,
    }));
    return { agents };
  }

  private async hasOAuthCredentials(): Promise<boolean> {
    const [claude, codex, gemini] = await Promise.all([
      this.readCredFile<ClaudeCredFile>('claude.json'),
      this.readCredFile<CodexCredFile>('codex.json'),
      this.readCredFile<GeminiCredFile>('gemini.json'),
    ]);
    return !!(claude?.claudeAiOauth?.accessToken || codex?.tokens?.access_token || gemini?.access_token);
  }

  private async loadState(): Promise<void> {
    try {
      const raw = await readFile(this.stateFilePath, 'utf-8');
      const data = JSON.parse(raw) as PersistedUsageState;
      if (data.agents && typeof data.agents === 'object') {
        const now = Date.now();
        for (const [id, entry] of Object.entries(data.agents)) {
          if (entry.info) {
            this.agentStates.set(id, {
              info: entry.info,
              lastFetchTime: typeof entry.lastFetchTime === 'number' ? entry.lastFetchTime : 0,
            });
          }
          if (typeof entry.backoffUntil === 'number' && entry.backoffUntil > now) {
            this.rateLimitBackoff.set(id, entry.backoffUntil);
          }
        }
      }
    } catch {
      // File doesn't exist or is invalid — start fresh
    }
  }

  private async saveState(): Promise<void> {
    const agents: PersistedUsageState['agents'] = {};
    for (const [id, state] of this.agentStates) {
      agents[id] = {
        info: state.info,
        lastFetchTime: state.lastFetchTime,
        backoffUntil: this.rateLimitBackoff.get(id) ?? 0,
      };
    }
    try {
      await writeFile(this.stateFilePath, JSON.stringify({ agents }));
    } catch (err) {
      useLogger().error(`[usage-checker] failed to save state: ${err instanceof Error ? err.message : err}`);
    }
  }

  private async deleteLegacyFiles(): Promise<void> {
    const legacyFiles = [
      join(this.config.dataDir, 'usage-backoff.json'),
      join(this.config.dataDir, 'usage-last-fetch.json'),
    ];
    for (const file of legacyFiles) {
      try { await unlink(file); } catch { /* doesn't exist — fine */ }
    }
  }

  private fetchAll(): Promise<void> {
    this.fetchQueue = this.fetchQueue.then(() => this.doFetchAll()).catch(() => {});
    return this.fetchQueue;
  }

  private async doFetchAll(): Promise<void> {
    const now = Date.now();

    // Only fetch agents whose data is stale (older than POLL_INTERVAL_MS)
    const fetchers: Array<() => Promise<AgentUsageInfo>> = [];
    const agentIds = ['claude', 'codex', 'gemini'] as const;
    const fetchFns = [
      () => this.fetchClaudeUsage(),
      () => this.fetchCodexUsage(),
      () => this.fetchGeminiUsage(),
    ];

    for (let i = 0; i < agentIds.length; i++) {
      const existing = this.agentStates.get(agentIds[i]);
      if (!existing || now - existing.lastFetchTime >= POLL_INTERVAL_MS) {
        fetchers.push(fetchFns[i]!);
      }
    }

    if (fetchers.length === 0) return;

    const results = await Promise.all(fetchers.map((fn) => fn()));

    for (const info of results) {
      this.agentStates.set(info.agentId, {
        info,
        lastFetchTime: now,
      });
    }
    await this.saveState();
  }

  private async readCredFile<T>(fileName: string): Promise<T | null> {
    try {
      const raw = await readFile(join(CRED_DIR, fileName), 'utf-8');
      const trimmed = raw.trim();
      if (trimmed.length <= 2) return null;
      return JSON.parse(trimmed) as T;
    } catch {
      return null;
    }
  }

  private detectAuthType(agentId: string, hasOAuth: boolean): AgentAuthType {
    if (hasOAuth) return 'oauth';
    const keyMap: Record<string, string> = {
      claude: 'anthropicApiKey',
      codex: 'openaiApiKey',
      gemini: 'geminiApiKey',
    };
    const configKey = keyMap[agentId];
    if (configKey && this.config[configKey as keyof Config]) return 'api-key';
    return 'none';
  }

  // ─── Claude ────────────────────────────────────────────────────

  private async fetchClaudeUsage(): Promise<AgentUsageInfo> {
    const now = new Date().toISOString();
    const cred = await this.readCredFile<ClaudeCredFile>('claude.json');
    const token = cred?.claudeAiOauth?.accessToken;
    const authType = this.detectAuthType('claude', !!token);

    const base: AgentUsageInfo = {
      agentId: 'claude',
      displayName: 'Claude',
      authType,
      usageAvailable: false,
      windows: [],
      lastChecked: now,
    };

    if (!token) return base;

    // Skip if rate-limited
    const backoffUntil = this.rateLimitBackoff.get('claude');
    if (backoffUntil && Date.now() < backoffUntil) {
      base.error = `Rate limited — retrying after ${new Date(backoffUntil).toISOString()}`;
      return base;
    }

    try {
      const resp = await fetch('https://api.anthropic.com/api/oauth/usage', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'anthropic-beta': 'oauth-2025-04-20',
        },
      });

      if (resp.status === 429) {
        const retryAfter = resp.headers.get('retry-after');
        const delaySec = retryAfter ? parseInt(retryAfter, 10) : 600;
        const delayMs = (Number.isFinite(delaySec) && delaySec > 0 ? delaySec : 600) * 1000;
        this.rateLimitBackoff.set('claude', Date.now() + delayMs);
        await this.saveState();
        base.error = `Rate limited — retry after ${delaySec}s`;
        return base;
      }

      // Clear backoff on success or non-429 responses
      if (this.rateLimitBackoff.delete('claude')) await this.saveState();

      if (!resp.ok) {
        base.error = `HTTP ${resp.status}`;
        return base;
      }

      interface ClaudeWindow { utilization: number; resets_at: string }
      const data = await resp.json() as {
        five_hour?: ClaudeWindow | null;
        seven_day?: ClaudeWindow | null;
        seven_day_sonnet?: ClaudeWindow | null;
      };

      base.usageAvailable = true;
      if (data.five_hour) {
        base.windows.push({
          label: 'Session',
          utilization: data.five_hour.utilization,
          resetsAt: data.five_hour.resets_at,
        });
      }
      if (data.seven_day) {
        base.windows.push({
          label: 'Weekly',
          utilization: data.seven_day.utilization,
          resetsAt: data.seven_day.resets_at,
        });
      }
      if (data.seven_day_sonnet) {
        base.windows.push({
          label: 'Sonnet',
          utilization: data.seven_day_sonnet.utilization,
          resetsAt: data.seven_day_sonnet.resets_at,
        });
      }
    } catch (err: unknown) {
      base.error = err instanceof Error ? err.message : String(err);
    }

    return base;
  }

  // ─── Codex ─────────────────────────────────────────────────────

  private async fetchCodexUsage(): Promise<AgentUsageInfo> {
    const now = new Date().toISOString();
    const cred = await this.readCredFile<CodexCredFile>('codex.json');
    let token = cred?.tokens?.access_token;
    const refreshToken = cred?.tokens?.refresh_token;
    const authType = this.detectAuthType('codex', !!token);

    const base: AgentUsageInfo = {
      agentId: 'codex',
      displayName: 'Codex',
      authType,
      usageAvailable: false,
      windows: [],
      lastChecked: now,
    };

    if (!token) return base;

    // Refresh token if last_refresh > 8 days ago
    if (refreshToken && cred?.last_refresh) {
      const lastRefresh = new Date(cred.last_refresh).getTime();
      const eightDays = 8 * 24 * 60 * 60 * 1000;
      if (Date.now() - lastRefresh > eightDays) {
        try {
          token = await this.refreshCodexToken(refreshToken, cred);
        } catch (err: unknown) {
          base.error = `Token refresh failed: ${err instanceof Error ? err.message : String(err)}`;
          return base;
        }
      }
    }

    // Skip if rate-limited
    const codexBackoff = this.rateLimitBackoff.get('codex');
    if (codexBackoff && Date.now() < codexBackoff) {
      base.error = `Rate limited — retrying after ${new Date(codexBackoff).toISOString()}`;
      return base;
    }

    try {
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
      };
      if (cred?.tokens?.account_id) {
        headers['ChatGPT-Account-Id'] = cred.tokens.account_id;
      }

      const resp = await fetch('https://chatgpt.com/backend-api/wham/usage', { headers });

      if (resp.status === 429) {
        const retryAfter = resp.headers.get('retry-after');
        const delaySec = retryAfter ? parseInt(retryAfter, 10) : 600;
        const delayMs = (Number.isFinite(delaySec) && delaySec > 0 ? delaySec : 600) * 1000;
        this.rateLimitBackoff.set('codex', Date.now() + delayMs);
        await this.saveState();
        base.error = `Rate limited — retry after ${delaySec}s`;
        return base;
      }

      if (this.rateLimitBackoff.delete('codex')) await this.saveState();

      if (!resp.ok) {
        base.error = `HTTP ${resp.status}`;
        return base;
      }

      interface CodexWindow { used_percent: number; reset_at: number; limit_window_seconds: number }
      const data = await resp.json() as {
        plan_type?: string;
        rate_limit?: {
          primary_window?: CodexWindow | null;
          secondary_window?: CodexWindow | null;
        };
        credits?: {
          has_credits?: boolean;
          unlimited?: boolean;
          balance?: string;
        };
      };

      base.usageAvailable = true;
      if (data.plan_type) base.planType = data.plan_type;

      if (data.rate_limit?.primary_window) {
        const w = data.rate_limit.primary_window;
        base.windows.push({
          label: 'Session',
          utilization: w.used_percent,
          resetsAt: new Date(w.reset_at * 1000).toISOString(),
        });
      }
      if (data.rate_limit?.secondary_window) {
        const w = data.rate_limit.secondary_window;
        base.windows.push({
          label: 'Weekly',
          utilization: w.used_percent,
          resetsAt: new Date(w.reset_at * 1000).toISOString(),
        });
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

  private async refreshCodexToken(refreshToken: string, cred: CodexCredFile): Promise<string> {
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

    const data = await resp.json() as {
      access_token: string;
      refresh_token?: string;
      id_token?: string;
    };

    // Write updated tokens back
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

    await writeFile(join(CRED_DIR, 'codex.json'), JSON.stringify(updated, null, 2));
    useLogger().info('[usage-checker] refreshed Codex OAuth token');
    return data.access_token;
  }

  // ─── Gemini ────────────────────────────────────────────────────

  private async fetchGeminiUsage(): Promise<AgentUsageInfo> {
    const now = new Date().toISOString();
    const cred = await this.readCredFile<GeminiCredFile>('gemini.json');
    const token = cred?.access_token;
    const authType = this.detectAuthType('gemini', !!token);

    const base: AgentUsageInfo = {
      agentId: 'gemini',
      displayName: 'Gemini',
      authType,
      usageAvailable: false,
      windows: [],
      lastChecked: now,
    };

    if (!token) return base;

    // Check if token is expired — we can't refresh without the CLI's client_id/secret
    if (cred?.expiry_date && cred.expiry_date < Date.now()) {
      base.error = 'Token expired — run gemini in a worker to refresh';
      return base;
    }

    // Skip if rate-limited
    const geminiBackoff = this.rateLimitBackoff.get('gemini');
    if (geminiBackoff && Date.now() < geminiBackoff) {
      base.error = `Rate limited — retrying after ${new Date(geminiBackoff).toISOString()}`;
      return base;
    }

    try {
      const resp = await fetch('https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });

      if (resp.status === 429) {
        const retryAfter = resp.headers.get('retry-after');
        const delaySec = retryAfter ? parseInt(retryAfter, 10) : 600;
        const delayMs = (Number.isFinite(delaySec) && delaySec > 0 ? delaySec : 600) * 1000;
        this.rateLimitBackoff.set('gemini', Date.now() + delayMs);
        await this.saveState();
        base.error = `Rate limited — retry after ${delaySec}s`;
        return base;
      }

      if (this.rateLimitBackoff.delete('gemini')) await this.saveState();

      if (!resp.ok) {
        base.error = `HTTP ${resp.status}`;
        return base;
      }

      const data = await resp.json() as {
        buckets?: Array<{
          modelId?: string;
          remainingFraction?: number;
          resetTime?: string;
          tokenType?: string;
        }>;
      };

      base.usageAvailable = true;

      if (data.buckets && data.buckets.length > 0) {
        // Group buckets by model family (Pro vs Flash)
        const families: Record<string, { lowestRemaining: number; earliestReset: string | null }> = {};

        for (const bucket of data.buckets) {
          const modelId = bucket.modelId || '';
          let family: string;
          if (modelId.includes('-pro')) {
            family = 'Pro';
          } else if (modelId.includes('-flash')) {
            family = 'Flash';
          } else {
            family = modelId;
          }

          if (!families[family]) {
            families[family] = { lowestRemaining: 1, earliestReset: null };
          }
          const f = families[family]!;

          const remaining = bucket.remainingFraction ?? 1;
          if (remaining < f.lowestRemaining) {
            f.lowestRemaining = remaining;
          }
          if (bucket.resetTime) {
            if (!f.earliestReset || bucket.resetTime < f.earliestReset) {
              f.earliestReset = bucket.resetTime;
            }
          }
        }

        // Sort: Pro first, then Flash, then others
        const order = ['Pro', 'Flash'];
        const sorted = Object.keys(families).sort((a, b) => {
          const ai = order.indexOf(a);
          const bi = order.indexOf(b);
          return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        });

        for (const family of sorted) {
          const f = families[family]!;
          base.windows.push({
            label: family,
            utilization: Math.round((1 - f.lowestRemaining) * 100),
            resetsAt: f.earliestReset,
          });
        }
      }
    } catch (err: unknown) {
      base.error = err instanceof Error ? err.message : String(err);
    }

    return base;
  }
}
