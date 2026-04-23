import { test, expect } from '@playwright/test';
import { goToDashboard, selectSidebarTab } from '../helpers/ui-helpers';

test.describe('Settings Modal', () => {
  async function openSettingsModal(page: import('@playwright/test').Page) {
    await goToDashboard(page);
    await selectSidebarTab(page, 'System');

    const systemSettingsBtn = page.locator('button:has-text("System Settings")');
    await expect(systemSettingsBtn).toBeVisible({ timeout: 10_000 });
    await systemSettingsBtn.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    return dialog;
  }

  test('System tab shows System Settings button', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'System');
    await expect(page.getByText('System Settings').first()).toBeVisible({ timeout: 10_000 });
  });

  test('"System Settings" button is visible and opens modal', async ({ page }) => {
    const dialog = await openSettingsModal(page);
    await expect(dialog).toBeVisible();
  });

  test('modal has "System Settings" title', async ({ page }) => {
    const dialog = await openSettingsModal(page);
    await expect(dialog.getByText('System Settings').first()).toBeVisible({ timeout: 10_000 });
  });

  test('has "Expand all" and "Collapse all" buttons', async ({ page }) => {
    const dialog = await openSettingsModal(page);
    await expect(dialog.getByText('Expand all')).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByText('Collapse all')).toBeVisible({ timeout: 10_000 });
  });

  test('contains expected section labels', async ({ page }) => {
    const dialog = await openSettingsModal(page);

    // Agent Authentication section was removed — agent API keys + tokens
    // are per-user now and live in the Account modal, not System Settings.
    const expectedSections = [
      'Docker & Infrastructure',
      'Worker Defaults',
      'Git Providers',
      'Network',
      'Logging',
      'Authentication',
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
    await expect(dialog.getByText('Docker Network')).toBeVisible({ timeout: 10_000 });

    // Click the section header to collapse it
    await dialog.getByText('Docker & Infrastructure').click();
    await expect(dialog.getByText('Docker Network')).toBeHidden({ timeout: 10_000 });

    // Click again to expand
    await dialog.getByText('Docker & Infrastructure').click();
    await expect(dialog.getByText('Docker Network')).toBeVisible({ timeout: 10_000 });
  });

  test('"Expand all" expands all sections', async ({ page }) => {
    const dialog = await openSettingsModal(page);
    await expect(dialog.getByText('Docker & Infrastructure')).toBeVisible({ timeout: 10_000 });

    // Collapse all first
    await dialog.getByText('Collapse all').click();
    await page.waitForTimeout(300);
    await expect(dialog.getByText('Docker Network')).toBeHidden({ timeout: 10_000 });

    // Expand all
    await dialog.getByText('Expand all').click();
    await page.waitForTimeout(300);
    await expect(dialog.getByText('Docker Network')).toBeVisible({ timeout: 10_000 });
  });

  test('"Collapse all" collapses all sections', async ({ page }) => {
    const dialog = await openSettingsModal(page);
    await expect(dialog.getByText('Docker & Infrastructure')).toBeVisible({ timeout: 10_000 });

    await expect(dialog.getByText('Docker Network')).toBeVisible({ timeout: 10_000 });

    // Collapse all
    await dialog.getByText('Collapse all').click();
    await page.waitForTimeout(300);
    await expect(dialog.getByText('Docker Network')).toBeHidden({ timeout: 10_000 });
  });

  test('Close button closes modal', async ({ page }) => {
    const dialog = await openSettingsModal(page);

    await dialog.locator('button:has-text("Close")').click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
  });

  test('settings items display key, label, and value', async ({ page }) => {
    const dialog = await openSettingsModal(page);
    await expect(dialog.getByText('Docker & Infrastructure')).toBeVisible({ timeout: 10_000 });

    await expect(dialog.getByText('Docker Network')).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByText('DOCKER_NETWORK')).toBeVisible({ timeout: 10_000 });
  });
});
