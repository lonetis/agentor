import { createError, getRequestURL } from 'h3';
import { resolveAuthFromEvent } from '../utils/auth-helpers';

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
  if (isPublicApi(path)) return;

  const ctx = await resolveAuthFromEvent(event);
  if (!ctx) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
  }
  (event.context as any).auth = ctx;
});
