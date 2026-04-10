import { chromium, request as playwrightRequest, type FullConfig } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const TEST_ADMIN_EMAIL = 'admin@agentor.test';
export const TEST_ADMIN_PASSWORD = 'admin-test-password-12345';
export const TEST_ADMIN_NAME = 'Test Admin';

/**
 * Playwright global setup — runs once before any test.
 *
 * Ensures the orchestrator has an admin user (creates one via the setup flow
 * if needed) and saves the authenticated storage state to
 * `tests/.auth/admin.json`. Playwright projects then point `storageState` at
 * that file so every test runs as the admin user by default.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = process.env.BASE_URL || 'http://localhost:3000';

  // Use a shared request context so cookies persist across calls
  const req = await playwrightRequest.newContext({
    baseURL,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Origin: baseURL },
  });

  // Poll health to ensure the orchestrator is up (dev server startup can take a moment)
  for (let i = 0; i < 30; i++) {
    try {
      const res = await req.get('/api/health');
      if (res.status() === 200) break;
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  // First-run: if no users exist, create the admin
  const statusRes = await req.get('/api/setup/status');
  if (statusRes.ok()) {
    const body = await statusRes.json();
    if (body?.needsSetup) {
      const createRes = await req.post('/api/setup/create-admin', {
        data: {
          email: TEST_ADMIN_EMAIL,
          password: TEST_ADMIN_PASSWORD,
          name: TEST_ADMIN_NAME,
        },
      });
      if (!createRes.ok()) {
        throw new Error(`Failed to create test admin: ${createRes.status()} ${await createRes.text()}`);
      }
    }
  }

  // Sign in as the admin — cookies are captured in this request context
  const signInRes = await req.post('/api/auth/sign-in/email', {
    data: {
      email: TEST_ADMIN_EMAIL,
      password: TEST_ADMIN_PASSWORD,
    },
  });
  if (!signInRes.ok()) {
    throw new Error(`Failed to sign in test admin: ${signInRes.status()} ${await signInRes.text()}`);
  }

  // Save storage state (cookies) for API tests
  const apiStatePath = join(__dirname, '.auth/admin-api.json');
  mkdirSync(dirname(apiStatePath), { recursive: true });
  await req.storageState({ path: apiStatePath });
  await req.dispose();

  // For the UI project, we need a browser storage state (origin + localStorage)
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
  const page = await context.newPage();

  // Go to login page and sign in via the UI so the cookie domain matches.
  // Retry the first navigation a few times — the dockerized runner can hit
  // chromium's NETWORK_CHANGED on the very first request (likely a netlink
  // event from inner-DinD bridge setup racing chromium's init).
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await page.goto('/login', { waitUntil: 'domcontentloaded', timeout: 15_000 });
      lastErr = undefined;
      break;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (lastErr) throw lastErr;
  // Wait until either login form is ready or we're redirected
  try {
    await page.waitForSelector('input[type="email"]', { timeout: 10_000 });
    await page.fill('input[type="email"]', TEST_ADMIN_EMAIL);
    await page.fill('input[type="password"]', TEST_ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    // Wait for redirect away from /login
    await page.waitForURL((url) => !url.pathname.startsWith('/login') && !url.pathname.startsWith('/setup'), { timeout: 15_000 }).catch(() => {});
  } catch {
    // Setup or login may have auto-redirected
  }

  const uiStatePath = join(__dirname, '.auth/admin-ui.json');
  mkdirSync(dirname(uiStatePath), { recursive: true });
  await context.storageState({ path: uiStatePath });
  await browser.close();
}
