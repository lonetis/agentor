import { test, expect, type Page } from '@playwright/test';
import { selectSidebarTab } from '../helpers/ui-helpers';

const STORAGE_KEY = 'agentor-ui-state';

/**
 * The dashboard shell on a phone: the sidebar is an overlay opened from the
 * floating expand button, it gets out of the way once a pane opens, and
 * modals opened from it are painted on top of it.
 */
test.describe('Mobile layout', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  async function loadDashboard(page: Page) {
    // Start without persisted panes, so the placeholder shows. Cleared from a
    // non-SPA page, so no dashboard can flush its state back on unload.
    await page.goto('/api/health');
    await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
    await page.goto('/');
    await expect(page.locator('button[title="Expand sidebar"]')).toBeVisible({ timeout: 15_000 });
  }

  async function sidebarWidth(page: Page): Promise<number> {
    return page.locator('aside').evaluate((el) => el.getBoundingClientRect().width);
  }

  async function openOverlay(page: Page) {
    await page.locator('button[title="Expand sidebar"]').tap();
    await expect(page.locator('.sidebar-backdrop')).toBeVisible();
    // Wait for the slide-in to finish.
    await expect.poll(() => sidebarWidth(page)).toBeGreaterThan(300);
  }

  test('the sidebar starts collapsed and opens as an overlay', async ({ page }) => {
    await loadDashboard(page);
    await expect.poll(() => sidebarWidth(page)).toBeLessThanOrEqual(1);
    await expect(page.locator('.sidebar-backdrop')).toHaveCount(0);

    await openOverlay(page);
    // A strip of backdrop always stays visible to tap.
    expect(await sidebarWidth(page)).toBeLessThanOrEqual(334);
    // The panes behind the overlay are out of the tab order.
    await expect(page.locator('main')).toHaveAttribute('inert', '');
    await expect(page.locator('button[title="Collapse sidebar"]')).toBeFocused();
  });

  test('Escape closes the overlay and focuses the expand button', async ({ page }) => {
    await loadDashboard(page);
    await openOverlay(page);

    await page.keyboard.press('Escape');

    await expect(page.locator('.sidebar-backdrop')).toHaveCount(0);
    await expect(page.locator('button[title="Expand sidebar"]')).toBeFocused();
    await expect(page.locator('main')).not.toHaveAttribute('inert');
  });

  test('tapping the backdrop closes the overlay', async ({ page }) => {
    await loadDashboard(page);
    await openOverlay(page);

    // The backdrop strip right of the 320px overlay.
    await page.touchscreen.tap(370, 400);

    await expect(page.locator('.sidebar-backdrop')).toHaveCount(0);
    await expect(page.locator('button[title="Expand sidebar"]')).toBeVisible();
  });

  async function openLogsFromOverlay(page: Page) {
    await openOverlay(page);
    await selectSidebarTab(page, 'System');
    await page.locator('aside .system-card-link').filter({ hasText: 'Logs' }).click();
    await expect(page.locator('.log-pane')).toBeVisible({ timeout: 10_000 });
  }

  test('opening a pane closes the overlay', async ({ page }) => {
    await loadDashboard(page);
    await openLogsFromOverlay(page);

    await expect(page.locator('.sidebar-backdrop')).toHaveCount(0);
    await expect(page.locator('button[title="Expand sidebar"]')).toBeVisible();
  });

  test('the expand button does not cover the first pane tab', async ({ page }) => {
    await loadDashboard(page);
    await openLogsFromOverlay(page);
    await expect.poll(() => sidebarWidth(page)).toBeLessThanOrEqual(1);

    const fab = await page.locator('button[title="Expand sidebar"]').boundingBox();
    const tab = await page.locator('main .pane-tab-bar .tab-item').first().boundingBox();
    expect(fab).not.toBeNull();
    expect(tab).not.toBeNull();
    expect(fab!.x + fab!.width).toBeLessThanOrEqual(tab!.x + 1);
    // It stays within the tab bar row, clear of the pane content below.
    expect(fab!.y + fab!.height).toBeLessThanOrEqual(tab!.y + tab!.height + 1);
  });

  test('a modal opened from the overlay is painted on top of it', async ({ page }) => {
    await loadDashboard(page);
    await openOverlay(page);

    await page.locator('aside button:has-text("+ New Worker")').tap();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // Hit-test the dialog's centre: the overlay must not be painted above it.
    // The open modal sets `pointer-events: none` on <body>, which would hide the
    // overlay from hit-testing, so the shell is made hit-testable for the probe.
    await expect.poll(() => dialog.evaluate((el) => {
      const shell = document.querySelector<HTMLElement>('.app-shell')!;
      shell.style.pointerEvents = 'auto';
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      shell.style.pointerEvents = '';
      return !!hit && el.contains(hit);
    })).toBe(true);

    // Escape closes the dialog first; the overlay stays open behind it.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.sidebar-backdrop')).toBeVisible();
  });

  test('the empty-pane placeholder opens the New Worker modal', async ({ page }) => {
    await loadDashboard(page);
    await expect(page.locator('main').getByText('Create a worker from the sidebar to get started')).toBeVisible();

    await page.locator('main').getByRole('button', { name: 'Create worker' }).tap();

    await expect(page.locator('[role="dialog"] h2')).toHaveText('New Worker', { timeout: 10_000 });
  });
});
