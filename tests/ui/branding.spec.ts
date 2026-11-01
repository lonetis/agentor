import { test, expect, type Locator, type Page } from '@playwright/test';
import { goToDashboard } from '../helpers/ui-helpers';

// The Agentor mark rendered by `AppLogo.vue`.
const LOGO = '[data-testid="agentor-logo"]';

/** The image is visible AND actually decoded (a broken `src` renders as a 0×0 placeholder). */
async function expectLogoLoaded(logo: Locator): Promise<void> {
  await expect(logo).toBeVisible();
  await expect
    .poll(() => logo.evaluate((img) => (img as HTMLImageElement).naturalWidth), { timeout: 10_000 })
    .toBeGreaterThan(0);
}

async function expectHeadLink(page: Page, selector: string): Promise<void> {
  await expect(page.locator(`head ${selector}`)).toHaveCount(1);
}

test.describe('Branding', () => {
  test('sidebar header shows the Agentor mark next to the heading', async ({ page }) => {
    await goToDashboard(page);
    await expectLogoLoaded(page.locator(`aside ${LOGO}`));
    // The text heading stays — the mark is decorative, the name is still read as text.
    await expect(page.locator('aside h1:has-text("Agentor")')).toBeVisible();
    await expect(page.locator('aside p:has-text("Orchestrator")')).toBeVisible();
  });

  test('document head links the favicon set and the web manifest', async ({ page }) => {
    await goToDashboard(page);
    await expectHeadLink(page, 'link[rel="icon"][href="/favicon.ico"]');
    await expectHeadLink(page, 'link[rel="icon"][type="image/png"][sizes="32x32"][href="/favicon-32x32.png"]');
    await expectHeadLink(page, 'link[rel="icon"][type="image/png"][sizes="16x16"][href="/favicon-16x16.png"]');
    await expectHeadLink(page, 'link[rel="apple-touch-icon"][sizes="180x180"][href="/apple-touch-icon.png"]');
    await expectHeadLink(page, 'link[rel="manifest"][href="/site.webmanifest"]');
  });

  test('document head carries the installable-app and mobile metadata', async ({ page }) => {
    await goToDashboard(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    const viewport = page.locator('head meta[name="viewport"]');
    await expect(viewport).toHaveCount(1);
    await expect(viewport).toHaveAttribute('content', /viewport-fit=cover/);
    // Pinch-zoom must stay available (accessibility).
    await expect(viewport).not.toHaveAttribute('content', /maximum-scale|user-scalable/);
    await expect(page.locator('head meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Agentor');
    await expect(page.locator('head meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
    await expect(page.locator('head meta[name="mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
    // Credentials keep the manifest loadable behind the dashboard's basic auth.
    await expect(page.locator('head link[rel="manifest"][href="/site.webmanifest"]')).toHaveAttribute(
      'crossorigin',
      'use-credentials',
    );
  });

  test('favicon and app icons are served from the site root', async ({ request }) => {
    const icons = [
      '/favicon.ico',
      '/favicon-16x16.png',
      '/favicon-32x32.png',
      '/favicon-48x48.png',
      '/apple-touch-icon.png',
      '/android-chrome-192x192.png',
      '/android-chrome-512x512.png',
      '/maskable-icon-192x192.png',
      '/maskable-icon-512x512.png',
    ];
    for (const path of icons) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
      expect(res.headers()['content-type'], path).toMatch(/^image\//);
      expect((await res.body()).length, path).toBeGreaterThan(0);
    }
  });

  test('web manifest is served and describes Agentor with its app icons', async ({ request }) => {
    const res = await request.get('/site.webmanifest');
    expect(res.status()).toBe(200);
    const manifest = JSON.parse(await res.text());
    expect(manifest.name).toBe('Agentor');
    expect(manifest.short_name).toBe('Agentor');
    expect(manifest.start_url).toBe('/');
    expect(manifest.icons.map((i: { src: string; purpose: string }) => [i.src, i.purpose])).toEqual([
      ['/android-chrome-192x192.png', 'any'],
      ['/android-chrome-512x512.png', 'any'],
      ['/maskable-icon-192x192.png', 'maskable'],
      ['/maskable-icon-512x512.png', 'maskable'],
    ]);
  });
});

test.describe('Branding on the login page', () => {
  // Fresh context: a signed-in visitor would be redirected from /login to /.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('login page shows the Agentor mark above the heading', async ({ page }) => {
    await page.goto('/login');
    await expectLogoLoaded(page.locator(LOGO));
    await expect(page.locator('h1:has-text("Agentor")')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });
});
