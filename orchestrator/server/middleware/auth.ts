import { createError, getRequestURL } from 'h3';
import { useAuth } from '../utils/auth';
import type { AuthContext } from '../utils/auth-helpers';

/**
 * Public API prefixes that bypass auth:
 * - /api/auth/** — better-auth's own sign-in/sign-out/session endpoints
 * - /api/health — health probe (Docker healthcheck, monitoring)
 * - /api/setup/** — first-run admin creation endpoints
 * - /api/docs/** — OpenAPI spec and Scalar UI
 */
const PUBLIC_API_PREFIXES = [
  '/api/auth/',
  '/api/health',
  '/api/setup/',
  '/api/docs',
];

function isPublicApi(path: string): boolean {
  return PUBLIC_API_PREFIXES.some((p) => path === p || path.startsWith(p));
}

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname;

  // Only guard /api/ routes. Non-API paths (SPA assets, /ws/, /editor/, /desktop/)
  // are either served as static files or handled by their own auth hooks.
  if (!path.startsWith('/api/')) return;

  // Allow public API endpoints through
  if (isPublicApi(path)) return;

  const auth = useAuth();
  const headers = event.headers;

  let session: any = null;
  try {
    session = await auth.api.getSession({ headers });
  } catch {
    session = null;
  }

  if (!session || !session.user || !session.session) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
  }

  const ctx: AuthContext = {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role ?? null,
    },
    session: {
      id: session.session.id,
      token: session.session.token,
      userId: session.session.userId,
      expiresAt: new Date(session.session.expiresAt),
    },
  };

  (event.context as any).auth = ctx;
});
