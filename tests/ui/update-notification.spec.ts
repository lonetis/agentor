import { test, expect } from '@playwright/test';
import { goToDashboard } from '../helpers/ui-helpers';

test.describe('Update Notification / Images Section', () => {
  test('Images section exists in sidebar', async ({ page }) => {
    await goToDashboard(page);
    await expect(page.locator('text=IMAGES')).toBeVisible();
  });

  test('shows image names', async ({ page }) => {
    await goToDashboard(page);
    // Should show the four tracked images (exact match to avoid "Orchestrator" subtitle)
    const aside = page.locator('aside');
    await expect(aside.getByText('orchestrator', { exact: true })).toBeVisible();
    await expect(aside.getByText('worker', { exact: true })).toBeVisible();
    await expect(aside.getByText('mapper', { exact: true })).toBeVisible();
    await expect(aside.getByText('traefik', { exact: true })).toBeVisible();
  });

  test('can toggle Images section', async ({ page }) => {
    await goToDashboard(page);
    const btn = page.locator('button:has-text("IMAGES")');
    await expect(btn).toBeVisible();
    // Collapse
    await btn.click();
    await page.waitForTimeout(300);
    // Re-expand
    await btn.click();
    await page.waitForTimeout(300);
  });
});
