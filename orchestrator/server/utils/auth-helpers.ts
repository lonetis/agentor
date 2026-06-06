import type { H3Event } from 'h3';
import { createError } from 'h3';
import { useAuth } from './auth';
import { useContainerManager } from './services';
import type { ContainerInfo } from '../../shared/types';

export interface AuthContext {
  user: {
    id: string;
    email: string;
    name: string;
    role?: string | null;
  };
  session: {
    id: string;
    token: string;
    userId: string;
    expiresAt: Date;
  };
}

/**
 * Extracts the auth context from the event. Throws 401 if unauthenticated.
 * The server middleware populates event.context.auth, so this is a simple accessor.
 */
export function requireAuth(event: H3Event): AuthContext {
  const auth = (event.context as any).auth as AuthContext | undefined;
  if (!auth) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
  }
  return auth;
}

/**
 * Extracts the auth context and verifies the user has the admin role.
 * Throws 401 if unauthenticated, 403 if not an admin.
 */
export function requireAdmin(event: H3Event): AuthContext {
  const ctx = requireAuth(event);
  if (ctx.user.role !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: admin role required' });
  }
  return ctx;
}

/**
 * Checks if the requesting user owns a resource or is an admin.
 * Returns true if allowed, false otherwise. Throws 404 if the resource is null.
 */
export function canAccessResource(
  ctx: AuthContext,
  resource: { userId?: string | null } | undefined | null,
  { allowGlobal = true }: { allowGlobal?: boolean } = {}
): boolean {
  if (!resource) return false;
  if (ctx.user.role === 'admin') return true;
  if (allowGlobal && (resource.userId === null || resource.userId === undefined)) return true;
  return resource.userId === ctx.user.id;
}

/**
 * Verifies the requesting user owns the resource or is admin. Throws 403 if not.
 * Built-in/global resources (userId === null) can be read by all but should be
 * blocked from mutation by the caller using `allowGlobal: false`.
 */
export function requireResourceAccess(
  event: H3Event,
  resource: { userId?: string | null } | undefined | null,
  opts?: { allowGlobal?: boolean }
): AuthContext {
  const ctx = requireAuth(event);
  if (!canAccessResource(ctx, resource, opts)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: you do not own this resource' });
  }
  return ctx;
}

/**
 * Verifies the requesting user owns the container (by container id or name) or is admin.
 * Throws 404 if container not found, 403 if not owned.
 */
export function requireContainerAccess(
  event: H3Event,
  container: { userId: string } | undefined | null
): AuthContext {
  if (!container) {
    throw createError({ statusCode: 404, statusMessage: 'Container not found' });
  }
  const ctx = requireAuth(event);
  if (ctx.user.role === 'admin') return ctx;
  if (container.userId !== ctx.user.id) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: you do not own this container' });
  }
  return ctx;
}

/**
 * Normalises a better-auth `getSession` result into our AuthContext shape.
 * Returns null if the session is missing or incomplete.
 */
function toAuthContext(session: any): AuthContext | null {
  if (!session || !session.user || !session.session) return null;
  return {
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
}

/**
 * Loads the auth context directly from an h3 event. Used by routes outside
 * `/api/` that are not covered by the global auth middleware (e.g. the
 * `/editor/*` and `/desktop/*` reverse proxies). Returns null on any error
 * or missing session — the caller decides whether to throw 401.
 */
export async function resolveAuthFromEvent(event: H3Event): Promise<AuthContext | null> {
  try {
    const auth = useAuth();
    const session: any = await auth.api.getSession({ headers: event.headers });
    return toAuthContext(session);
  } catch {
    return null;
  }
}

/**
 * Like `resolveAuthFromEvent` but throws 401 instead of returning null.
 */
export async function requireAuthFromEvent(event: H3Event): Promise<AuthContext> {
  const ctx = await resolveAuthFromEvent(event);
  if (!ctx) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
  return ctx;
}

/**
 * Shared preamble for the `/editor/*` and `/desktop/*` reverse proxies (which
 * live outside `/api/` and so are not covered by the global auth middleware).
 *
 * Order matters: authenticate FIRST, then resolve the worker (404), then
 * ownership-check (403). Authenticating first means an unauthenticated probe
 * always gets 401 regardless of whether the worker id exists, so the route
 * never doubles as a worker-existence oracle for unauthenticated callers.
 *
 * `workerId` is the worker's UUID `id` (the route's `:containerId` segment),
 * not the Docker container id.
 */
export async function resolveOwnedRunningContainer(
  event: H3Event,
  workerId: string,
): Promise<ContainerInfo> {
  const ctx = await requireAuthFromEvent(event);
  const info = useContainerManager().get(workerId);
  if (!info || info.status !== 'running') {
    throw createError({ statusCode: 404, statusMessage: 'Container not found or not running' });
  }
  if (ctx.user.role !== 'admin' && info.userId !== ctx.user.id) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }
  return info;
}

/**
 * Validates a WebSocket peer by checking its upgrade request's cookies.
 * Returns the auth context if valid, null otherwise.
 * Used in crossws `open` handlers to reject unauthenticated connections.
 */
export async function authenticateWsPeer(peer: any): Promise<AuthContext | null> {
  try {
    // `peer.ctx` is documented-dead in Nitro's bundled crossws (see CLAUDE.md
    // gotchas), so only the Headers `.get('cookie')` path and the plain-property
    // fallback (for any non-Headers peer shape) are used.
    const cookieHeader = peer?.request?.headers?.get?.('cookie')
      ?? peer?.request?.headers?.cookie
      ?? '';
    if (!cookieHeader) return null;

    const auth = useAuth();
    const session: any = await auth.api.getSession({ headers: new Headers({ cookie: cookieHeader }) });
    return toAuthContext(session);
  } catch {
    return null;
  }
}
