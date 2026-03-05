import { test, expect } from '@playwright/test';
import { goToDashboard } from '../helpers/ui-helpers';

test.describe('Sidebar', () => {
  test.describe('Collapse/Expand', () => {
    test('sidebar is visible by default', async ({ page }) => {
      await goToDashboard(page);
      await expect(page.locator('aside')).toBeVisible();
    });

    test('can collapse the sidebar', async ({ page }) => {
      await goToDashboard(page);
      // Click the collapse button (double chevron icon in sidebar header)
      await page.click('button[title="Collapse sidebar"]');
      await page.waitForTimeout(500);
      // After collapse, the floating expand button should be visible
      await expect(page.locator('button[title="Expand sidebar"]')).toBeVisible();
    });

    test('can expand a collapsed sidebar', async ({ page }) => {
      await goToDashboard(page);
      await page.click('button[title="Collapse sidebar"]');
      await page.waitForTimeout(500);
      await page.click('button[title="Expand sidebar"]');
      await page.waitForTimeout(500);
      // Sidebar content should be visible again — check for the title
      await expect(page.locator('h1:has-text("Agentor")')).toBeVisible();
    });
  });

  test.describe('Collapsible Sections', () => {
    test('Port Mappings section is collapsible', async ({ page }) => {
      await goToDashboard(page);
      const btn = page.locator('button:has-text("PORT MAPPINGS")');
      await expect(btn).toBeVisible();
      // Toggle to collapse
      await btn.click();
      await page.waitForTimeout(300);
      // Toggle again to expand
      await btn.click();
      await page.waitForTimeout(300);
    });

    test('Images section is collapsible', async ({ page }) => {
      await goToDashboard(page);
      const btn = page.locator('button:has-text("IMAGES")');
      await expect(btn).toBeVisible();
      await btn.click();
      await page.waitForTimeout(300);
      await btn.click();
      await page.waitForTimeout(300);
    });
  });

  test.describe('Theme Toggle', () => {
    test('theme toggle buttons are visible', async ({ page }) => {
      await goToDashboard(page);
      // The theme toggle has 3 small icon buttons next to the collapse button in the sidebar header
      // Look for the button group containing the theme icons (monitor, sun, moon)
      const collapseBtn = page.locator('button[title="Collapse sidebar"]');
      await expect(collapseBtn).toBeVisible();
      // The theme buttons are siblings of the collapse button
      const headerButtons = page.locator('aside h1').locator('..').locator('button');
      // Should have at least 4 buttons (3 theme + 1 collapse)
      expect(await headerButtons.count()).toBeGreaterThanOrEqual(4);
    });
  });
});
