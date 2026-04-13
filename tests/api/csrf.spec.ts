import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN_STORAGE = resolve(__dirname, '..', '.auth/admin-api.json');

/**
 * Reads the admin session cookies from the global-setup-generated storage
 * state file and returns a Cookie header value.
 */
function adminCookieHeader(): string {
  if (!existsSync(ADMIN_STORAGE)) return '';
  try {
    const state = JSON.parse(readFileSync(ADMIN_STORAGE, 'utf-8'));
    const cookies = (state?.cookies ?? []) as Array<{ name: string; value: string }>;
    return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  } catch {
    return '';
  }
}

/**
 * better-auth enforces an `Origin` (or `Referer`) header on all mutating
 * requests and rejects any origin that isn't in `trustedOrigins`. These tests
 * use Node's native `fetch()` directly (not Playwright's APIRequestContext,
 * which auto-populates Origin on every request) so we can send requests with
 * no Origin at all.
 */
test.describe('CSRF / Origin enforcement', () => {
  test('sign-in without Origin header is rejected', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'anything@test.example', password: 'whatever' }),
    });
    expect(res.status).toBe(403);
    const body: any = await res.json();
    expect(String(body.code || body.message || '')).toMatch(/origin/i);
  });

  test('sign-in with localhost Origin is accepted (trusted)', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: BASE_URL,
      },
      body: JSON.stringify({ email: 'does-not-exist@test.example', password: 'wrong-pw' }),
    });
    // Should NOT be 403 (CSRF) — better-auth should have accepted the
    // origin and reached credential validation, returning a normal auth
    // error (401 / 4xx with INVALID_EMAIL_OR_PASSWORD).
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(200);
  });

  test('change-password without Origin header is rejected (even with valid session)', async () => {
    const cookie = adminCookieHeader();
    expect(cookie).toBeTruthy();

    const res = await fetch(`${BASE_URL}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({
        currentPassword: 'anything',
        newPassword: 'newpassword12345',
        revokeOtherSessions: false,
      }),
    });
    // Expect 403 "Missing or null Origin" — the session is valid but the
    // CSRF check runs before credential validation.
    expect(res.status).toBe(403);
  });

  test('sign-up endpoint also enforces the Origin check', async () => {
    // Even the sign-up endpoint enforces the CSRF check.
    const res = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'noone@test.example',
        password: 'wouldnt-matter-anyway',
        name: 'X',
      }),
    });
    expect(res.status).toBe(403);
  });
});
