import { test, expect } from '@playwright/test';
import { goToDashboard } from '../helpers/ui-helpers';

test.describe('Settings Modal', () => {
  async function openSettingsModal(page: import('@playwright/test').Page) {
    await goToDashboard(page);

    // The "System Settings" button is inside the Settings section at the bottom of the sidebar.
    // It may be off-screen — scroll it into view if needed.
    const systemSettingsBtn = page.locator('button:has-text("System Settings")');

    // If not visible, the Settings section might be collapsed or off-screen
    const isVisible = await systemSettingsBtn.isVisible().catch(() => false);
    if (!isVisible) {
      // Try scrolling the sidebar to the bottom
      await page.evaluate(() => {
        const sidebar = document.querySelector('[class*="sidebar"], [class*="overflow-y-auto"]');
        if (sidebar) sidebar.scrollTop = sidebar.scrollHeight;
      });
      await page.waitForTimeout(300);

      // If still not visible, the section might be collapsed — expand it
      const stillNotVisible = !(await systemSettingsBtn.isVisible().catch(() => false));
      if (stillNotVisible) {
        // Click the Settings section header to expand it
        const settingsHeaders = page.locator('button:has-text("Settings")');
        const count = await settingsHeaders.count();
        // Find the section header (not "System Settings")
        for (let i = 0; i < count; i++) {
          const text = await settingsHeaders.nth(i).textContent();
          if (text?.trim() === 'Settings' || (text?.includes('Settings') && !text?.includes('System'))) {
            await settingsHeaders.nth(i).click();
            await page.waitForTimeout(300);
            break;
          }
        }
      }
    }

    await expect(systemSettingsBtn).toBeVisible({ timeout: 5_000 });
    await systemSettingsBtn.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    return dialog;
  }

  test('Settings section is visible in sidebar', async ({ page }) => {
    await goToDashboard(page);
    // The sidebar always has a Settings section
    await expect(page.getByText('System Settings').first()).toBeVisible({ timeout: 10_000 });
  });

  test('"System Settings" button is visible and opens modal', async ({ page }) => {
    const dialog = await openSettingsModal(page);
    await expect(dialog).toBeVisible();
  });

  test('modal has "System Settings" title', async ({ page }) => {
    const dialog = await openSettingsModal(page);
    await expect(dialog.getByText('System Settings').first()).toBeVisible({ timeout: 5_000 });
  });

  test('has "Expand all" and "Collapse all" buttons', async ({ page }) => {
    const dialog = await openSettingsModal(page);
    await expect(dialog.getByText('Expand all')).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText('Collapse all')).toBeVisible({ timeout: 5_000 });
  });

  test('contains expected section labels', async ({ page }) => {
    const dialog = await openSettingsModal(page);

    const expectedSections = [
      'Docker & Infrastructure',
      'Worker Defaults',
      'Agent Authentication',
      'Git Providers',
      'Network',
      'Init Scripts',
      'App Types',
    ];

    for (const label of expectedSections) {
      await expect(dialog.getByText(label, { exact: false }).first()).toBeVisible({ timeout: 10_000 });
    }
  });

  test('sections are collapsible (click header to toggle)', async ({ page }) => {
    const dialog = await openSettingsModal(page);

    await expect(dialog.getByText('Docker & Infrastructure')).toBeVisible({ timeout: 10_000 });

    // A setting item inside Docker section should be visible
    await expect(dialog.getByText('Docker Network')).toBeVisible({ timeout: 5_000 });

    // Click the section header to collapse it
    await dialog.getByText('Docker & Infrastructure').click();
    await expect(dialog.getByText('Docker Network')).toBeHidden({ timeout: 5_000 });

    // Click again to expand
    await dialog.getByText('Docker & Infrastructure').click();
    await expect(dialog.getByText('Docker Network')).toBeVisible({ timeout: 5_000 });
  });

  test('"Expand all" expands all sections', async ({ page }) => {
    const dialog = await openSettingsModal(page);
    await expect(dialog.getByText('Docker & Infrastructure')).toBeVisible({ timeout: 10_000 });

    // Collapse all first
    await dialog.getByText('Collapse all').click();
    await page.waitForTimeout(300);
    await expect(dialog.getByText('Docker Network')).toBeHidden({ timeout: 5_000 });

    // Expand all
    await dialog.getByText('Expand all').click();
    await page.waitForTimeout(300);
    await expect(dialog.getByText('Docker Network')).toBeVisible({ timeout: 5_000 });
  });

  test('"Collapse all" collapses all sections', async ({ page }) => {
    const dialog = await openSettingsModal(page);
    await expect(dialog.getByText('Docker & Infrastructure')).toBeVisible({ timeout: 10_000 });

    await expect(dialog.getByText('Docker Network')).toBeVisible({ timeout: 5_000 });

    // Collapse all
    await dialog.getByText('Collapse all').click();
    await page.waitForTimeout(300);
    await expect(dialog.getByText('Docker Network')).toBeHidden({ timeout: 5_000 });
  });

  test('Close button closes modal', async ({ page }) => {
    const dialog = await openSettingsModal(page);

    await dialog.locator('button:has-text("Close")').click();
    await expect(dialog).toBeHidden({ timeout: 5_000 });
  });

  test('settings items display key, label, and value', async ({ page }) => {
    const dialog = await openSettingsModal(page);
    await expect(dialog.getByText('Docker & Infrastructure')).toBeVisible({ timeout: 10_000 });

    await expect(dialog.getByText('Docker Network')).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText('DOCKER_NETWORK')).toBeVisible({ timeout: 5_000 });
  });
});
