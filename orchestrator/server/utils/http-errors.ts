import { createError } from 'h3';

/**
 * Re-throws an error that already carries an HTTP status code (i.e. it came
 * from `createError`), otherwise wraps it in a 500 Internal Server Error.
 *
 * Used by route handlers that guard a mutation with domain-level validation
 * (which throws 4xx `createError`s) but also want to translate unexpected
 * Docker/library errors into a useful 500 response.
 *
 * The `never` return type lets TypeScript treat this as a terminating call.
 */
export function rethrowAsHttpError(err: unknown, fallbackMessage = 'Operation failed'): never {
  const maybe = err as { statusCode?: unknown } | null;
  // Only preserve genuine HTTP error codes (4xx/5xx) from `createError`. A
  // library error carrying a non-error status — e.g. dockerode's 304 "container
  // already stopped" — must not surface as a bodyless HTTP 304; wrap it in a 500.
  if (maybe && typeof maybe.statusCode === 'number' && maybe.statusCode >= 400) throw err;
  const message = err instanceof Error ? err.message : fallbackMessage;
  throw createError({ statusCode: 500, statusMessage: message });
}
