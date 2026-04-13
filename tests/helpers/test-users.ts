import { request as playwrightRequest, type APIRequestContext, type BrowserContext } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN_STORAGE = resolve(__dirname, '..', '.auth/admin-api.json');

const CONTEXT_OPTS = {
  baseURL: BASE_URL,
  extraHTTPHeaders: { Origin: BASE_URL },
  storageState: { cookies: [], origins: [] },
};

export interface CreatedUser {
  email: string;
  password: string;
  name: string;
  id: string;
}

/**
 * Creates a regular (role: 'user') account via the admin API. Returns the
 * generated email/password and the user ID. The caller is responsible for
 * cleanup if needed (delete by ID via the admin API).
 */
export async function createTestUser(name = 'Passkey Test'): Promise<CreatedUser> {
  const stamp = Date.now() + Math.floor(Math.random() * 10_000);
  const email = `pk-${stamp}@test.example`;
  const password = `pk-pass-${stamp}-strong`;

  const adminCtx = await playwrightRequest.newContext({
    ...CONTEXT_OPTS,
    storageState: ADMIN_STORAGE,
  });
  try {
    const res = await adminCtx.post('/api/auth/admin/create-user', {
      data: { email, password, name, role: 'user' },
    });
    if (!res.ok()) {
      throw new Error(`Failed to create test user: ${res.status()} ${await res.text()}`);
    }
    const body = await res.json();
    const id = body?.user?.id ?? body?.id;
    if (!id) throw new Error('Admin createUser did not return a user id');
    return { email, password, name, id };
  } finally {
    await adminCtx.dispose();
  }
}

/**
 * Sign a browser context in as the given user via the public sign-in
 * endpoint. Cookies stay attached to the context for subsequent navigations.
 *
 * `signInURL` defaults to the test's global `BASE_URL`. Pass an explicit URL
 * (e.g. `https://dash.docker.localhost`) for tests that need to exercise the
 * Traefik-terminated origin — this is required for passkey tests because
 * WebAuthn ties the credential to the exact origin the browser is on.
 */
export async function signInBrowserAsUser(
  context: BrowserContext,
  email: string,
  password: string,
  signInURL: string = BASE_URL,
): Promise<void> {
  const apiContext: APIRequestContext = context.request;
  const res = await apiContext.post(`${signInURL}/api/auth/sign-in/email`, {
    headers: { Origin: signInURL, 'Content-Type': 'application/json' },
    data: { email, password },
  });
  if (!res.ok()) {
    throw new Error(`Failed to sign in ${email}: ${res.status()} ${await res.text()}`);
  }
}

/**
 * Delete a test user (cleanup helper). Idempotent — ignores errors.
 */
export async function deleteTestUser(userId: string): Promise<void> {
  const adminCtx = await playwrightRequest.newContext({
    ...CONTEXT_OPTS,
    storageState: ADMIN_STORAGE,
  });
  try {
    await adminCtx.post('/api/auth/admin/remove-user', {
      data: { userId },
    });
  } catch {
    // ignore
  } finally {
    await adminCtx.dispose();
  }
}
