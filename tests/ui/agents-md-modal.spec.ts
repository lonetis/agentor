import { test, expect } from '@playwright/test';
import { goToDashboard } from '../helpers/ui-helpers';
import { cleanupAllCustomAgentsMd } from '../helpers/worker-lifecycle';

test.describe('AGENTS.md Modal', () => {
  test.afterEach(async ({ request }) => {
    await cleanupAllCustomAgentsMd(request);
  });

  test('AGENTS.md button is visible and opens modal', async ({ page }) => {
    await goToDashboard(page);
    const btn = page.locator('button:has-text("AGENTS.md")');
    await expect(btn).toBeVisible({ timeout: 10_000 });
    await btn.click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
  });

  test('modal has "AGENTS.md" title', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("AGENTS.md")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog.locator('h2')).toHaveText('AGENTS.md');
  });

  test('built-in entry (platform-guide) is listed', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("AGENTS.md")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // The built-in entry name is parsed from the first heading in the markdown file
    // It should show the "Built-in" badge
    const badges = dialog.getByText('Built-in');
    await expect(badges.first()).toBeVisible({ timeout: 10_000 });
  });

  test('Close button closes the modal', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("AGENTS.md")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await dialog.locator('button:has-text("Close")').click();
    await expect(dialog).toBeHidden({ timeout: 5_000 });
  });

  test('Escape key closes the modal', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("AGENTS.md")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 5_000 });
  });

  test('"New" button shows editor form', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("AGENTS.md")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await dialog.locator('button:has-text("New")').click();

    await expect(dialog.getByText('Name', { exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText('Content')).toBeVisible({ timeout: 5_000 });
    await expect(dialog.locator('input[placeholder="Entry name"]')).toBeVisible();
    await expect(dialog.locator('textarea')).toBeVisible();
  });

  test('Cancel in editor returns to list view', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("AGENTS.md")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await dialog.locator('button:has-text("New")').click();
    await expect(dialog.getByText('Name', { exact: true })).toBeVisible({ timeout: 5_000 });

    await dialog.locator('button:has-text("Cancel")').click();

    // Should return to list — "New" button visible again
    await expect(dialog.locator('button:has-text("New")')).toBeVisible({ timeout: 5_000 });
    // Built-in entry should be visible
    await expect(dialog.getByText('Built-in').first()).toBeVisible({ timeout: 5_000 });
  });

  test('create custom entry flow', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("AGENTS.md")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    const entryName = `test-entry-${Date.now()}`;

    await dialog.locator('button:has-text("New")').click();
    await expect(dialog.locator('input[placeholder="Entry name"]')).toBeVisible({ timeout: 5_000 });

    await dialog.locator('input[placeholder="Entry name"]').fill(entryName);
    await dialog.locator('textarea').fill('# Test Entry\n\nSome test content for AGENTS.md');

    await dialog.locator('button:has-text("Create")').click();

    // Should return to list and show the new entry
    await expect(dialog.locator('button:has-text("New")')).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText(entryName)).toBeVisible({ timeout: 10_000 });
  });
});
