import { createError, getRequestURL, readBody } from 'h3';
import { useAuth, getCredentialSummary } from '../utils/auth';

/**
 * Guards against deleting the user's last credential.
 *
 * Better-auth's passkey plugin exposes `POST /api/auth/passkey/delete-passkey`
 * which removes a single passkey by ID. We can't easily wrap that endpoint
 * via plugin hooks, so we intercept the request before it hits the catch-all
 * handler: if removing the targeted passkey would leave the user with zero
 * passkeys AND no password, the request is rejected with 409.
 *
 * This middleware runs for the entire `/api/auth/passkey/delete-passkey`
 * path only — every other auth endpoint is left untouched.
 */
const DELETE_PASSKEY_PATH = '/api/auth/passkey/delete-passkey';

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname;
  if (path !== DELETE_PASSKEY_PATH) return;
  if (event.method !== 'POST') return;

  const auth = useAuth();
  let session: any = null;
  try {
    session = await auth.api.getSession({ headers: event.headers });
  } catch {
    session = null;
  }
  if (!session?.user) {
    // Let better-auth itself emit the unauthorized error.
    return;
  }

  const summary = getCredentialSummary(session.user.id);
  // If they already have a password, deleting any passkey is fine.
  if (summary.hasPassword) return;
  // No password — they can only delete a passkey if they have at least 2.
  if (summary.passkeyCount > 1) return;

  throw createError({
    statusCode: 409,
    statusMessage: 'Cannot remove your last passkey while no password is set',
  });
});
