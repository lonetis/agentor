import { betterAuth } from 'better-auth';
import { admin } from 'better-auth/plugins';
import { passkey } from '@better-auth/passkey';
import { getMigrations } from 'better-auth/db/migration';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { loadConfig } from './config';
import { consumeSetupToken } from './setup-token-store';

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

export interface PasskeyConfig {
  enabled: boolean;
  /** The full dashboard host (e.g. `dash.docker.localhost`). Used as rpID. */
  rpID?: string;
  /** The public https URL the dashboard is served from. Used as origin. */
  origin?: string;
}

/**
 * Decides whether passkey authentication should be available, and what rpID
 * and origin to pass to the passkey plugin.
 *
 * WebAuthn requires:
 *   1. An `origin` that's either `https://...` or `http://localhost` (strict!)
 *   2. An `rpID` that's a registrable suffix of the browser's current origin
 *
 * If the dashboard is served over Traefik (DASHBOARD_SUBDOMAIN and
 * DASHBOARD_BASE_DOMAIN are set), we use that domain as both the origin and
 * the rpID. Otherwise passkeys are disabled entirely — they can't be made to
 * work reliably when the dashboard is reached by raw IP / localhost because
 * the rpID would have to match whatever the browser happens to be on.
 *
 * Override the auto-detected rpID via `BETTER_AUTH_RP_ID` for advanced setups.
 */
function resolvePasskeyConfig(config: ReturnType<typeof loadConfig>): PasskeyConfig {
  const sub = config.dashboardSubdomain;
  const base = config.dashboardBaseDomain;
  if (!sub || !base) {
    return { enabled: false };
  }

  const host = `${sub}.${base}`;
  const origin = `https://${host}`;
  const rpID = process.env.BETTER_AUTH_RP_ID?.trim() || host;
  return { enabled: true, rpID, origin };
}

function buildAuth(): any {
  const config = loadConfig();
  const dbPath = join(config.dataDir, 'auth.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  _db = db;

  const baseURL = process.env.BETTER_AUTH_URL || 'http://localhost:3000';
  const passkeyCfg = resolvePasskeyConfig(config);

  return betterAuth({
    database: db,
    basePath: '/api/auth',
    baseURL,
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
    plugins: [
      admin(),
      ...(passkeyCfg.enabled
        ? [
            passkey({
              rpName: 'Agentor',
              rpID: passkeyCfg.rpID!,
              origin: passkeyCfg.origin!,
              registration: {
                // Allow passkey registration without an existing session —
                // required for the first-run admin setup and for any
                // "passkey-only" account creation flow. The `resolveUser`
                // callback (below) consumes a one-shot token to look up or
                // create the user.
                requireSession: false,
                resolveUser: async ({ context }) => {
                  const meta = consumeSetupToken(context);
                  if (!meta) {
                    throw new Error('Invalid or expired setup token');
                  }
                  // First-admin tokens may only be redeemed when no users exist.
                  if (meta.initialAdmin && hasAnyUsers()) {
                    throw new Error('Setup is already complete');
                  }

                  const db = getAuthDb();
                  // Has the user been pre-created (e.g. admin used the
                  // regular create-user flow without password)? If so, just
                  // bind the new passkey to that user.
                  const existing = db
                    .prepare('SELECT id, name FROM user WHERE email = ?')
                    .get(meta.email) as { id: string; name: string } | undefined;
                  if (existing) {
                    return { id: existing.id, name: existing.name };
                  }

                  // Otherwise create a fresh user (no password). The schema
                  // insert goes through the kysely adapter by way of direct
                  // SQL (faster than the plugin's full insert pipeline, and
                  // the passkey row is written by the plugin right after
                  // this callback returns).
                  const now = new Date();
                  const id = randomBytes(12).toString('base64url');
                  db.prepare(
                    `INSERT INTO user (id, email, name, emailVerified, role, createdAt, updatedAt)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                  ).run(id, meta.email, meta.name, 0, meta.role, now.toISOString(), now.toISOString());
                  return { id, name: meta.name };
                },
              },
            }),
          ]
        : []),
    ],
  });
}

/** Returns whether passkey authentication is enabled (dashboard is on Traefik). */
export function isPasskeyEnabled(): boolean {
  return resolvePasskeyConfig(loadConfig()).enabled;
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

export interface CredentialSummary {
  hasPassword: boolean;
  passkeyCount: number;
}

/**
 * Counts a user's available credentials. Used to enforce the "at least one
 * credential" invariant when removing a password or deleting the last passkey.
 *
 * - `hasPassword` is true when a row exists in the `account` table with
 *   `providerId = 'credential'` (better-auth's name for the email/password
 *   provider).
 * - `passkeyCount` is the number of rows in the `passkey` table for the user.
 */
export function getCredentialSummary(userId: string): CredentialSummary {
  const db = getAuthDb();
  let hasPassword = false;
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) as c FROM account WHERE userId = ? AND providerId = 'credential' AND password IS NOT NULL`,
      )
      .get(userId) as { c: number } | undefined;
    hasPassword = (row?.c ?? 0) > 0;
  } catch {
    hasPassword = false;
  }

  let passkeyCount = 0;
  try {
    const row = db
      .prepare('SELECT COUNT(*) as c FROM passkey WHERE userId = ?')
      .get(userId) as { c: number } | undefined;
    passkeyCount = row?.c ?? 0;
  } catch {
    passkeyCount = 0;
  }

  return { hasPassword, passkeyCount };
}

/**
 * Removes a user's password credential. Used by the `remove-password`
 * endpoint after the caller has verified at least one passkey is registered.
 */
export function removeUserPassword(userId: string): void {
  const db = getAuthDb();
  db.prepare(
    `DELETE FROM account WHERE userId = ? AND providerId = 'credential'`,
  ).run(userId);
}
