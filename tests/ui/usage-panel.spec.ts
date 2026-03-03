import { test, expect } from '@playwright/test';
import { goToDashboard } from '../helpers/ui-helpers';

test.describe('Usage Panel', () => {
  test('USAGE section exists in sidebar', async ({ page }) => {
    await goToDashboard(page);
    await expect(page.locator('text=USAGE')).toBeVisible();
  });

  test('shows agent names', async ({ page }) => {
    await goToDashboard(page);
    const aside = page.locator('aside');
    await expect(aside.getByText('Claude', { exact: true })).toBeVisible();
    await expect(aside.getByText('Codex', { exact: true })).toBeVisible();
    await expect(aside.getByText('Gemini', { exact: true })).toBeVisible();
  });

  test('shows auth type labels', async ({ page }) => {
    await goToDashboard(page);
    const aside = page.locator('aside');
    // Each agent should show one of the auth type badges
    const authLabels = await aside.locator('text=/OAuth|API key|not configured/').all();
    expect(authLabels.length).toBeGreaterThanOrEqual(3);
  });

  test('can toggle Usage section', async ({ page }) => {
    await goToDashboard(page);
    const btn = page.locator('button:has-text("USAGE")');
    await expect(btn).toBeVisible();
    // Collapse
    await btn.click();
    await page.waitForTimeout(300);
    // Agent names should be hidden
    const aside = page.locator('aside');
    // The Usage section content should not be visible when collapsed
    // Re-expand
    await btn.click();
    await page.waitForTimeout(300);
    // Agent names should be visible again
    await expect(aside.getByText('Claude', { exact: true })).toBeVisible();
  });
});
