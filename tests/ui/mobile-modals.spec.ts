import { test, expect, type Locator, type Page } from '@playwright/test';
import { openCreateWorkerModal } from '../helpers/ui-helpers';

/**
 * On a phone every modal is a full-screen sheet: it spans the viewport, a
 * repository row keeps a usable URL field, and the action row stays on screen.
 */
test.describe('Modals on phones', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  const VIEWPORT_WIDTH = 390;

  /** The phone layout starts with the sidebar collapsed; open its overlay. */
  async function openSidebarOverlay(page: Page): Promise<void> {
    await page.goto('/');
    const expand = page.locator('button[title="Expand sidebar"]');
    await expect(expand).toBeVisible({ timeout: 15_000 });
    await expand.tap();
    await expect(page.locator('.sidebar-backdrop')).toBeVisible();
  }

  /** Polls past the open animation (a scale-in) until the sheet spans the viewport. */
  async function expectFullWidthSheet(dialog: Locator): Promise<void> {
    await expect.poll(async () => {
      const box = await dialog.boundingBox();
      return box ? { x: Math.abs(Math.round(box.x)), width: Math.round(box.width) } : null;
    }).toEqual({ x: 0, width: VIEWPORT_WIDTH });
  }

  test('New Worker is a full-screen sheet with a usable repository field and an on-screen footer', async ({ page }) => {
    await openSidebarOverlay(page);
    await openCreateWorkerModal(page);
    const dialog = page.getByRole('dialog', { name: 'New Worker' });
    await expectFullWidthSheet(dialog);

    await dialog.locator('button:has-text("Add repository")').click();
    // "Repository URL" without a git token, the searchable "Repository" with one.
    const repo = dialog.getByRole('textbox', { name: /^Repository( URL)?$/ });
    await expect(repo).toBeVisible();
    // The row wraps on phones so the repo field gets a line of its own instead
    // of the few pixels left next to the provider and branch fields.
    expect((await repo.boundingBox())!.width).toBeGreaterThan(200);

    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeInViewport({ ratio: 1 });

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 10_000 });
  });

  test('Account settings is a full-screen sheet with a reachable Close button', async ({ page }) => {
    await openSidebarOverlay(page);
    await page.getByRole('button', { name: 'Account settings' }).tap();
    const dialog = page.getByRole('dialog', { name: 'Account settings' });
    await expectFullWidthSheet(dialog);

    const close = page.getByRole('button', { name: 'Close', exact: true });
    await expect(close).toBeInViewport({ ratio: 1 });
    await close.tap();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
  });
});
