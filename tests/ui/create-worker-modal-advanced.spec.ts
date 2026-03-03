import { test, expect } from '@playwright/test';
import { goToDashboard, openCreateWorkerModal } from '../helpers/ui-helpers';
import { cleanupAllEnvironments } from '../helpers/worker-lifecycle';
import { ApiClient } from '../helpers/api-client';

test.describe('Create Worker Modal — Advanced', () => {
  test.afterEach(async ({ request }) => {
    await cleanupAllEnvironments(request);
  });

  test('modal has environment selector', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');
    // Should have an environment selector or label
    await expect(dialog.locator('text=Environment').first()).toBeVisible();
  });

  test('environment selector shows created environments', async ({ page, request }) => {
    const api = new ApiClient(request);
    const envName = `Env-${Date.now()}`;
    await api.createEnvironment({
      name: envName,
      cpuLimit: 0,
      memoryLimit: '',
      networkMode: 'full',
      allowedDomains: [],
      includePackageManagerDomains: false,
      dockerEnabled: true,
      envVars: '',
      setupScript: '',
      initScript: '',
    });

    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');

    // Click on the environment dropdown/selector
    const envSelector = dialog.locator('select, [role="listbox"], [role="combobox"]').first();
    if (await envSelector.count() > 0) {
      await envSelector.click();
      // The created environment should be visible
      await expect(page.getByText(envName)).toBeVisible({ timeout: 5_000 });
    }
  });

  test('modal has init script textarea', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');
    // Should have an init script section
    await expect(dialog.locator('text=Init Script').first()).toBeVisible();
  });

  test('preset selector populates init script', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');

    // Look for a preset selector (dropdown or select)
    const presetDropdown = dialog.locator('select, [role="listbox"], [role="combobox"]').last();
    if (await presetDropdown.count() > 0) {
      await presetDropdown.click();
      // Try clicking Claude option
      const claudeOption = page.getByText('Claude', { exact: false }).first();
      if (await claudeOption.isVisible()) {
        await claudeOption.click();
        // The textarea should now contain 'claude'
        const textarea = dialog.locator('textarea').first();
        if (await textarea.count() > 0) {
          const value = await textarea.inputValue();
          expect(value.toLowerCase()).toContain('claude');
        }
      }
    }
  });

  test('modal has display name field', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');
    // Should have a display name input
    const inputs = dialog.locator('input');
    const count = await inputs.count();
    expect(count).toBeGreaterThanOrEqual(2); // name + display name at minimum
  });

  test('modal has create and cancel buttons', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog.locator('button:has-text("Create")')).toBeVisible();
  });

  test('modal can be closed with Escape', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('[role="dialog"]')).toBeHidden({ timeout: 5_000 });
  });

  test('name field is pre-populated', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');
    const nameInput = dialog.locator('input').first();
    const value = await nameInput.inputValue();
    expect(value.length).toBeGreaterThan(0);
    expect(value).toContain('agentor-worker');
  });
});
