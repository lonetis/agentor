import { test, expect, request as playwrightRequest } from '@playwright/test';
import WSImpl from 'ws';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestUser, deleteTestUser } from '../helpers/test-users';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const WS_URL = BASE_URL.replace(/^http/, 'ws');
const ADMIN_STORAGE = resolve(__dirname, '..', '.auth/admin-api.json');

function readAdminCookieHeader(): string {
  if (!existsSync(ADMIN_STORAGE)) return '';
  try {
    const state = JSON.parse(readFileSync(ADMIN_STORAGE, 'utf-8'));
    const cookies = (state?.cookies ?? []) as Array<{ name: string; value: string }>;
    return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  } catch {
    return '';
  }
}

/** Open a WebSocket and resolve once it's either open or closes. */
function dial(url: string, headers: Record<string, string> = {}): Promise<{ opened: boolean; closeCode?: number }> {
  return new Promise((resolvePromise) => {
    const ws = new WSImpl(url, { headers });
    let settled = false;
    const settle = (value: { opened: boolean; closeCode?: number }) => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* ignore */ }
      resolvePromise(value);
    };
    ws.on('open', () => {
      // Wait briefly in case the server closes right after open (auth fail)
      setTimeout(() => settle({ opened: true }), 500);
    });
    ws.on('close', (code) => settle({ opened: false, closeCode: code }));
    ws.on('error', () => settle({ opened: false }));
    setTimeout(() => settle({ opened: false }), 5_000);
  });
}

test.describe('WebSocket authentication', () => {
  test('terminal WebSocket without cookie is rejected', async () => {
    // No admin — no container to connect to. Use a random container ID.
    // Expect: the connection either closes immediately on the HTTP upgrade
    // response (401) or opens and closes right after with an auth message.
    const result = await dial(`${WS_URL}/ws/terminal/nonexistent`);
    // We don't require a specific close code — just that the connection
    // doesn't stay open indefinitely.
    expect(result.opened).toBe(false);
  });

  test('logs WebSocket without cookie is rejected', async () => {
    const result = await dial(`${WS_URL}/ws/logs`);
    expect(result.opened).toBe(false);
  });

  test('logs WebSocket with admin cookie is accepted', async () => {
    const cookie = readAdminCookieHeader();
    expect(cookie).toBeTruthy();
    const result = await dial(`${WS_URL}/ws/logs`, { Cookie: cookie });
    // The log broadcaster accepts the connection once auth passes —
    // `opened === true` means the upgrade succeeded and the connection
    // stayed open for at least 500ms.
    expect(result.opened).toBe(true);
  });

  test('logs WebSocket with regular user cookie is rejected (admin-only)', async () => {
    const user = await createTestUser('WS Log Denied');
    try {
      // Sign in via a fresh context so we capture the user's cookies.
      const ctx = await playwrightRequest.newContext({
        baseURL: BASE_URL,
        extraHTTPHeaders: { Origin: BASE_URL },
        storageState: { cookies: [], origins: [] },
      });
      try {
        await ctx.post('/api/auth/sign-in/email', {
          data: { email: user.email, password: user.password },
        });
        const state = await ctx.storageState();
        const cookieHeader = (state.cookies ?? [])
          .map((c) => `${c.name}=${c.value}`)
          .join('; ');
        expect(cookieHeader).toBeTruthy();

        const result = await dial(`${WS_URL}/ws/logs`, { Cookie: cookieHeader });
        expect(result.opened).toBe(false);
      } finally {
        await ctx.dispose();
      }
    } finally {
      await deleteTestUser(user.id);
    }
  });
});
