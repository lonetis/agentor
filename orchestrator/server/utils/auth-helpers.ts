import type { H3Event } from 'h3';
import { createError, getRequestHeaders } from 'h3';
import { useAuth } from './auth';

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
 * Returns the auth context if present, or null if not authenticated.
 * Used by routes that treat admins and regular users differently but do not
 * require auth (e.g., public status endpoints).
 */
export function getAuthOptional(event: H3Event): AuthContext | null {
  return ((event.context as any).auth as AuthContext | undefined) ?? null;
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
 * Validates a WebSocket peer by checking its upgrade request's cookies.
 * Returns the auth context if valid, null otherwise.
 * Used in crossws `open` handlers to reject unauthenticated connections.
 */
export async function authenticateWsPeer(peer: any): Promise<AuthContext | null> {
  try {
    const cookieHeader = peer?.request?.headers?.get?.('cookie')
      ?? peer?.ctx?.request?.headers?.cookie
      ?? peer?.request?.headers?.cookie
      ?? '';
    if (!cookieHeader) return null;

    const headers = new Headers({ cookie: cookieHeader });
    const auth = useAuth() as any;
    const session: any = await auth.api.getSession({ headers });
    if (!session || !session.user || !session.session) return null;

    return {
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        role: (session.user as any).role ?? null,
      },
      session: {
        id: session.session.id,
        token: session.session.token,
        userId: session.session.userId,
        expiresAt: new Date(session.session.expiresAt),
      },
    };
  } catch {
    return null;
  }
}
