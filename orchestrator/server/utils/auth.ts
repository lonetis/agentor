import { betterAuth } from 'better-auth';
import { admin } from 'better-auth/plugins';
import { getMigrations } from 'better-auth/db/migration';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { loadConfig } from './config';

// The return type of `betterAuth()` varies with plugins; we cast to any
// downstream to avoid double-type-definition issues from nested Zod/better-call.
let _auth: any = null;
let _db: Database.Database | null = null;

/**
 * Resolves the BETTER_AUTH_SECRET.
 * Reads from env var first, otherwise generates one and persists it to
 * `<dataDir>/.auth-secret` on first run so the secret survives restarts.
 */
function resolveAuthSecret(dataDir: string): string {
  const envSecret = process.env.BETTER_AUTH_SECRET?.trim();
  if (envSecret) return envSecret;

  const secretPath = join(dataDir, '.auth-secret');
  if (existsSync(secretPath)) {
    return readFileSync(secretPath, 'utf-8').trim();
  }

  const generated = randomBytes(32).toString('hex');
  writeFileSync(secretPath, generated, { encoding: 'utf-8' });
  try {
    chmodSync(secretPath, 0o600);
  } catch {
    // Ignore chmod failures on platforms that don't support it
  }
  return generated;
}

/**
 * Builds the list of trusted origins that better-auth will accept on the
 * `Origin` header of mutating requests (CSRF protection). Includes:
 *
 *   1. Direct dev access: `http://localhost:3000`, `http://127.0.0.1:3000`
 *   2. The dashboard URL when Traefik domain routing is configured
 *      (`DASHBOARD_SUBDOMAIN.DASHBOARD_BASE_DOMAIN`, both http and https variants)
 *   3. `BETTER_AUTH_URL` if set
 *   4. Any extra origins from `BETTER_AUTH_TRUSTED_ORIGINS` (comma-separated)
 */
function buildTrustedOrigins(config: ReturnType<typeof loadConfig>): string[] {
  const origins = new Set<string>([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ]);

  if (process.env.BETTER_AUTH_URL) {
    origins.add(process.env.BETTER_AUTH_URL);
  }

  if (config.dashboardSubdomain && config.dashboardBaseDomain) {
    const host = `${config.dashboardSubdomain}.${config.dashboardBaseDomain}`;
    // Trust both http and https — the scheme depends on the base domain's
    // TLS challenge type, and the browser's Origin header reflects whichever
    // scheme the user actually hit.
    origins.add(`http://${host}`);
    origins.add(`https://${host}`);
  }

  const extra = process.env.BETTER_AUTH_TRUSTED_ORIGINS?.trim();
  if (extra) {
    for (const o of extra.split(',').map((s) => s.trim()).filter(Boolean)) {
      origins.add(o);
    }
  }

  return Array.from(origins);
}

function buildAuth(): any {
  const config = loadConfig();
  const dbPath = join(config.dataDir, 'auth.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  _db = db;

  return betterAuth({
    database: db,
    basePath: '/api/auth',
    baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
    secret: resolveAuthSecret(config.dataDir),
    trustedOrigins: buildTrustedOrigins(config),
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
    },
    user: {
      // Allow users to change their own email without email verification.
      // Agentor does not send email, so we rely on the in-app session to
      // authorise the change (the user must still be signed in).
      changeEmail: {
        enabled: true,
        updateEmailWithoutVerification: true,
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // 1 day
    },
    advanced: {
      cookiePrefix: 'agentor',
    },
    plugins: [admin()],
  });
}

export function useAuth(): any {
  if (!_auth) _auth = buildAuth();
  return _auth;
}

/**
 * Runs better-auth schema migrations against the SQLite database.
 * Safe to call on every startup — creates missing tables/columns only.
 */
export async function migrateAuth(): Promise<void> {
  const auth = useAuth();
  const migrations = await getMigrations(auth.options);
  await migrations.runMigrations();
}

export function getAuthDb(): Database.Database {
  if (!_db) useAuth();
  return _db!;
}

/** Returns true if at least one user exists. */
export function hasAnyUsers(): boolean {
  const db = getAuthDb();
  try {
    const row = db.prepare('SELECT COUNT(*) as c FROM user').get() as { c: number } | undefined;
    return (row?.c ?? 0) > 0;
  } catch {
    // Table may not exist yet on a very fresh DB — treat as no users
    return false;
  }
}

/** Sets a user's role directly in the database (used by first-run setup). */
export function setUserRoleDirect(userId: string, role: string): void {
  const db = getAuthDb();
  db.prepare('UPDATE user SET role = ? WHERE id = ?').run(role, userId);
}
