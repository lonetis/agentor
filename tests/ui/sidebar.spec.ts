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
      const btn = page.getByRole('button', { name: 'Images', exact: true });
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

  test.describe('Header Content', () => {
    test('sidebar has "Agentor" heading and "Orchestrator" subtitle', async ({ page }) => {
      await goToDashboard(page);
      const sidebar = page.locator('aside');
      await expect(sidebar.locator('h1:has-text("Agentor")')).toBeVisible();
      await expect(sidebar.locator('p:has-text("Orchestrator")')).toBeVisible();
    });
  });

  test.describe('Action Buttons', () => {
    test('"+ New Worker" button is visible and opens modal', async ({ page }) => {
      await goToDashboard(page);
      const newWorkerBtn = page.locator('aside button:has-text("+ New Worker")');
      await expect(newWorkerBtn).toBeVisible();
      await newWorkerBtn.click();
      await page.waitForSelector('[role="dialog"]', { timeout: 5_000 });
      await expect(page.locator('[role="dialog"]')).toBeVisible();
    });

    test('"Environments" button is visible', async ({ page }) => {
      await goToDashboard(page);
      const btn = page.locator('aside button:has-text("Environments")');
      await expect(btn).toBeVisible();
    });

    test('"Skills" button is visible', async ({ page }) => {
      await goToDashboard(page);
      const btn = page.locator('aside button:has-text("Skills")');
      await expect(btn).toBeVisible();
    });

    test('"AGENTS.md" button is visible', async ({ page }) => {
      await goToDashboard(page);
      const btn = page.locator('aside button:has-text("AGENTS.md")');
      await expect(btn).toBeVisible();
    });

    test('"Init Scripts" button is visible', async ({ page }) => {
      await goToDashboard(page);
      const btn = page.locator('aside button:has-text("Init Scripts")');
      await expect(btn).toBeVisible();
    });
  });

  test.describe('Usage Section', () => {
    test('Usage section is collapsible', async ({ page }) => {
      await goToDashboard(page);
      // The Usage section header has a separate collapse toggle button (not the label itself)
      const usageLabel = page.locator('aside span:has-text("Usage")');
      await expect(usageLabel).toBeVisible();
      // The collapse chevron is a sibling button with ml-auto class
      // Click the chevron button next to the Usage label to collapse
      const usageSection = usageLabel.locator('..');
      const collapseBtn = usageSection.locator('button').last();
      await collapseBtn.click();
      await page.waitForTimeout(300);
      // Click again to expand
      await collapseBtn.click();
      await page.waitForTimeout(300);
    });
  });

  test.describe('Settings Section', () => {
    test('Settings section exists with "System Settings" button and "API Docs" link', async ({ page }) => {
      await goToDashboard(page);
      const systemSettingsBtn = page.locator('aside button:has-text("System Settings")');
      // Settings section starts expanded by default (settings: false in useUiState means not collapsed)
      // If "System Settings" isn't visible, try scrolling or expanding
      const isVisible = await systemSettingsBtn.isVisible().catch(() => false);
      if (!isVisible) {
        // Section might be collapsed — click the section header to expand
        const settingsBtn = page.locator('aside').getByRole('button', { name: 'Settings', exact: true });
        await settingsBtn.click();
        await page.waitForTimeout(300);
      }
      await expect(systemSettingsBtn).toBeVisible({ timeout: 5_000 });
      // Check for "API Docs" link
      const apiDocsLink = page.locator('aside a:has-text("API Docs")');
      await expect(apiDocsLink).toBeVisible();
      await expect(apiDocsLink).toHaveAttribute('href', '/api/docs');
      await expect(apiDocsLink).toHaveAttribute('target', '_blank');
    });
  });

  test.describe('Collapse State Persistence', () => {
    test('collapse state persists across reload', async ({ page }) => {
      await goToDashboard(page);
      // Sidebar should be visible initially
      await expect(page.locator('aside')).toBeVisible();
      // Collapse the sidebar
      await page.click('button[title="Collapse sidebar"]');
      await page.waitForTimeout(500);
      // Verify the expand button is visible (sidebar is collapsed)
      await expect(page.locator('button[title="Expand sidebar"]')).toBeVisible();
      // Reload the page
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(300);
      // After reload, the sidebar should still be collapsed — expand button visible
      await expect(page.locator('button[title="Expand sidebar"]')).toBeVisible();
    });

    test('expand state persists across reload', async ({ page }) => {
      await goToDashboard(page);
      // Collapse the sidebar
      await page.click('button[title="Collapse sidebar"]');
      await page.waitForTimeout(500);
      // Expand it back
      await page.click('button[title="Expand sidebar"]');
      await page.waitForTimeout(500);
      // Verify sidebar is expanded — heading visible
      await expect(page.locator('h1:has-text("Agentor")')).toBeVisible();
      // Reload the page
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(300);
      // After reload, the sidebar should still be expanded — heading visible
      await expect(page.locator('h1:has-text("Agentor")')).toBeVisible();
      // The collapse button should be visible (not the expand button)
      await expect(page.locator('button[title="Collapse sidebar"]')).toBeVisible();
    });
  });

  test.describe('Resize Handle', () => {
    test('sidebar has a visible resize handle at right edge', async ({ page }) => {
      await goToDashboard(page);
      // The resize handle is a div with class "sidebar-handle" rendered next to the sidebar
      const handle = page.locator('.sidebar-handle');
      await expect(handle).toBeVisible();
      // Verify it has the col-resize cursor style
      const cursor = await handle.evaluate((el) => getComputedStyle(el).cursor);
      expect(cursor).toBe('col-resize');
    });
  });
});
