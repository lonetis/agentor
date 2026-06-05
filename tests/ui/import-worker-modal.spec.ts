import { test, expect } from '@playwright/test';
import { goToDashboard } from '../helpers/ui-helpers';

test.describe('Import worker modal', () => {
  test('opens from the sidebar Import button with file + name inputs', async ({ page }) => {
    await goToDashboard(page);
    await page.click('button[aria-label="Import worker"]');

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog).toContainText('Import Worker');
    await expect(dialog.locator('[data-testid="import-file"]')).toBeVisible();
    await expect(dialog.locator('[data-testid="import-name"]')).toBeVisible();

    // Import is disabled until a bundle is chosen.
    await expect(dialog.locator('[data-testid="import-submit"]')).toBeDisabled();
  });

  test('choosing a bundle file enables Import', async ({ page }) => {
    await goToDashboard(page);
    await page.click('button[aria-label="Import worker"]');

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    await dialog.locator('[data-testid="import-file"]').setInputFiles({
      name: 'worker-export.tar',
      mimeType: 'application/x-tar',
      buffer: Buffer.from('dummy-bundle-contents'),
    });

    await expect(dialog.locator('[data-testid="import-submit"]')).toBeEnabled();
    await expect(dialog).toContainText('worker-export.tar');
  });
});
