import { randomBytes } from 'node:crypto';

/**
 * Short-lived in-memory store for one-shot setup tokens. Used to bridge a
 * passkey registration flow that needs to create a user as part of the
 * verification: the client calls a "request token" endpoint with the user's
 * email/name, then passes the returned token as the `context` to
 * `passkey.addPasskey()`. The passkey plugin's `resolveUser` callback consumes
 * the token to look up (or create) the user the credential will be bound to.
 *
 * Tokens are random, single-use, and expire after 5 minutes. The store is
 * intentionally process-local — there is no need to persist these across
 * restarts because the client flow is fully synchronous.
 */
export interface SetupTokenPayload {
  /** Email of the account to create. Must be unique. */
  email: string;
  /** Display name of the account to create. */
  name: string;
  /** Role to assign on creation. Defaults to 'user'. */
  role: 'admin' | 'user';
  /** Whether this token may be used only when no users currently exist. */
  initialAdmin: boolean;
}

interface StoredToken extends SetupTokenPayload {
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000;
const tokens = new Map<string, StoredToken>();

function purgeExpired() {
  const now = Date.now();
  for (const [token, entry] of tokens) {
    if (entry.expiresAt < now) tokens.delete(token);
  }
}

export function createSetupToken(payload: SetupTokenPayload): string {
  purgeExpired();
  const token = randomBytes(32).toString('hex');
  tokens.set(token, { ...payload, expiresAt: Date.now() + TTL_MS });
  return token;
}

/**
 * Atomically consume a token. Returns its payload if valid (and removes it),
 * or null if the token does not exist or has expired.
 */
export function consumeSetupToken(token: string | undefined | null): SetupTokenPayload | null {
  if (!token) return null;
  purgeExpired();
  const entry = tokens.get(token);
  if (!entry) return null;
  tokens.delete(token);
  if (entry.expiresAt < Date.now()) return null;
  return {
    email: entry.email,
    name: entry.name,
    role: entry.role,
    initialAdmin: entry.initialAdmin,
  };
}
