import { test, expect, request as playwrightRequest, type Page, type Route } from '@playwright/test';
import { goToDashboard } from '../helpers/ui-helpers';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// Every other UI spec blocks service workers (playwright.config.ts) so their
// page.route stubs keep working; this one exercises the real worker. Chromium
// refuses to register a service worker whose script is served with a
// certificate error unless --ignore-certificate-errors is set — the context's
// ignoreHTTPSErrors does not cover it (dockerized stack: self-signed TLS).
test.use({
  serviceWorkers: 'allow',
  launchOptions: { args: ['--ignore-certificate-errors'] },
});

type ManifestIcon = { src: string; sizes: string; type: string; purpose: string };

/** Width x height from a PNG's IHDR chunk (bytes 16-23). */
function pngSize(body: Buffer): string {
  return `${body.readUInt32BE(16)}x${body.readUInt32BE(20)}`;
}

/**
 * Opens the dashboard and waits until our service worker controls the page.
 * Skips the test where no worker can run: dev server, plain-http LAN origin,
 * or a failed registration.
 */
async function openControlledDashboard(page: Page): Promise<void> {
  await goToDashboard(page);
  const state = await page
    .waitForFunction(() => document.documentElement.dataset.pwaSw, null, { timeout: 10_000 })
    .then((handle) => handle.jsonValue());
  test.skip(
    state === 'dev' || state === 'insecure' || state === 'unsupported',
    `No service worker in this environment (data-pwa-sw="${state}")`,
  );
  test.skip(state === 'failed', 'Service worker registration failed (see the browser console)');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // The reload is the first navigation the active worker handles.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? ''))
    .toMatch(/\/sw\.js$/);
}

test.describe('Progressive Web App', () => {
  test('web manifest describes an installable standalone app with maskable icons', async ({ request }) => {
    const res = await request.get('/site.webmanifest');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(/manifest\+json|json/);
    const manifest = JSON.parse(await res.text());
    expect(manifest.id).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.background_color).toBe('#030712');
    expect(manifest.theme_color).toBe('#030712');

    const icons = manifest.icons as ManifestIcon[];
    for (const purpose of ['any', 'maskable']) {
      for (const size of ['192x192', '512x512']) {
        expect(icons.filter((i) => i.purpose === purpose && i.sizes === size), `${purpose} ${size}`).toHaveLength(1);
      }
    }
    for (const icon of icons) {
      const iconRes = await request.get(icon.src);
      expect(iconRes.status(), icon.src).toBe(200);
      expect(iconRes.headers()['content-type'], icon.src).toMatch(/^image\/png/);
      expect(pngSize(await iconRes.body()), icon.src).toBe(icon.sizes);
    }
  });

  test('service worker, offline page and manifest are served uncached and without a session', async () => {
    const anonymous = await playwrightRequest.newContext({
      baseURL: BASE_URL,
      ignoreHTTPSErrors: true,
      storageState: { cookies: [], origins: [] },
    });
    try {
      const sw = await anonymous.get('/sw.js');
      expect(sw.status()).toBe(200);
      expect(sw.headers()['content-type']).toMatch(/javascript/);
      expect(sw.headers()['cache-control']).toContain('no-cache');

      const offline = await anonymous.get('/offline.html');
      expect(offline.status()).toBe(200);
      expect(offline.headers()['content-type']).toMatch(/text\/html/);
      expect(offline.headers()['cache-control']).toContain('no-cache');
      const html = await offline.text();
      expect(html).toContain('Retry');
      // Self-contained: it is shown exactly when the server is unreachable.
      const references = [...html.matchAll(/\s(?:src|href)\s*=\s*["']([^"']*)["']/gi)].map((m) => m[1]);
      expect(references.filter((ref) => /^(?:https?:)?\/\//i.test(ref))).toEqual([]);

      const manifest = await anonymous.get('/site.webmanifest');
      expect(manifest.status()).toBe(200);
      expect(manifest.headers()['cache-control']).toContain('no-cache');
    } finally {
      await anonymous.dispose();
    }
  });

  test('registers the service worker at the root scope and caches the offline page', async ({ page }) => {
    await openControlledDashboard(page);
    expect(await page.evaluate(async () => (await navigator.serviceWorker.ready).scope === `${location.origin}/`)).toBe(true);
    expect(await page.evaluate(async () => !!(await caches.match('/offline.html')))).toBe(true);
  });

  test('page navigations go through the worker while API requests bypass it', async ({ page }) => {
    await openControlledDashboard(page);
    const apiResponse = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/containers');
    const navigation = await page.reload({ waitUntil: 'domcontentloaded' });
    expect(navigation?.fromServiceWorker()).toBe(true);
    expect((await apiResponse).fromServiceWorker()).toBe(false);
  });

  test('shows the offline page while unreachable and recovers on its own', async ({ page, context }) => {
    await openControlledDashboard(page);
    // The worker's own fetch of the page must fail like a dropped connection.
    // Offline emulation alone does not reliably reach the worker's requests in
    // every Chromium build; context routes do (Playwright routes service-worker
    // requests when service workers are allowed).
    const isDashboardDocument = (url: URL) => url.pathname === '/';
    const dropConnection = (route: Route) => route.abort('internetdisconnected');
    await context.route(isDashboardDocument, dropConnection);
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Agentor is unreachable' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();

    // Back online: the page's own health polling reloads into the dashboard.
    await context.unroute(isDashboardDocument, dropConnection);
    await context.setOffline(false);
    await expect(page.locator('aside h1:has-text("Agentor")')).toBeVisible({ timeout: 15_000 });
  });

  test('an unreachable session check shows the offline page instead of the login form', async ({ page, context }) => {
    await openControlledDashboard(page);
    const isSessionCheck = (url: URL) => url.pathname === '/api/auth/get-session';
    const dropConnection = (route: Route) => route.abort('internetdisconnected');
    await context.route(isSessionCheck, dropConnection);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Agentor is unreachable' })).toBeVisible();
    expect(new URL(page.url()).pathname).not.toBe('/login');

    // Once the server answers again the offline page returns to the dashboard.
    await context.unroute(isSessionCheck, dropConnection);
    await expect(page.locator('aside h1:has-text("Agentor")')).toBeVisible({ timeout: 15_000 });
  });

  test('theme-color meta follows the colour mode', async ({ page }) => {
    await goToDashboard(page);
    const themeColor = page.locator('head meta[name="theme-color"]');
    await expect(themeColor).toHaveCount(1);

    const themeButtons = page.locator('aside [data-theme-toggle] button');
    await themeButtons.nth(1).click(); // White
    await expect(themeColor).toHaveAttribute('content', '#f9fafb');
    await themeButtons.nth(2).click(); // Dark
    await expect(themeColor).toHaveAttribute('content', '#030712');
    await expect(themeColor).toHaveCount(1);
  });

  test('offers an Install app button once the browser allows installing', async ({ page }) => {
    await goToDashboard(page);
    await expect(page.getByRole('button', { name: 'Account settings' })).toBeVisible();
    const installButton = page.getByRole('button', { name: 'Install app' });
    await expect(installButton).toHaveCount(0);

    // Stand-in for Chromium's install prompt event.
    await page.evaluate(() => {
      const event = new Event('beforeinstallprompt') as Event & {
        prompt?: () => Promise<void>;
        userChoice?: Promise<{ outcome: 'accepted' | 'dismissed' }>;
      };
      event.prompt = async () => {
        (window as Window & { __prompted?: boolean }).__prompted = true;
      };
      event.userChoice = Promise.resolve({ outcome: 'accepted' });
      window.dispatchEvent(event);
    });
    await expect(installButton).toBeVisible();

    await installButton.click();
    await expect
      .poll(() => page.evaluate(() => (window as Window & { __prompted?: boolean }).__prompted === true))
      .toBe(true);
    // A prompt can be used only once.
    await expect(installButton).toHaveCount(0);
  });
});
