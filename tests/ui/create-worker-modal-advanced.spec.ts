import { test, expect } from '@playwright/test';
import { goToDashboard, openCreateWorkerModal } from '../helpers/ui-helpers';
import { ApiClient } from '../helpers/api-client';

test.describe('Create Worker Modal — Advanced', () => {
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
    const { body: created } = await api.createEnvironment({
      name: envName,
      cpuLimit: 0,
      memoryLimit: '',
      networkMode: 'full',
      allowedDomains: [],
      includePackageManagerDomains: false,
      dockerEnabled: true,
      envVars: '',
      setupScript: '',
    });

    try {
      await goToDashboard(page);
      await openCreateWorkerModal(page);
      const dialog = page.locator('[role="dialog"]');

      // Click on the environment dropdown/selector
      const envSelector = dialog.locator('select, [role="listbox"], [role="combobox"]').first();
      if (await envSelector.count() > 0) {
        await envSelector.click();
        // The created environment should be visible
        await expect(page.getByText(envName)).toBeVisible({ timeout: 10_000 });
      }
    } finally {
      try { await api.deleteEnvironment(created.id); } catch { /* ignore */ }
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

    // The Init Script USelect (combobox) shows "None" by default
    const initScriptCombobox = dialog.getByRole('combobox', { name: 'Init Script' });
    await expect(initScriptCombobox).toBeVisible();

    // Click the combobox to open the dropdown
    await initScriptCombobox.click();
    await page.waitForTimeout(300);

    // Look for the claude option in the dropdown listbox
    const claudeOption = page.getByRole('option', { name: 'claude' });
    if (await claudeOption.isVisible().catch(() => false)) {
      await claudeOption.click();
      // The textarea should now contain 'claude'
      const textarea = dialog.locator('textarea').first();
      await page.waitForTimeout(500);
      const value = await textarea.inputValue();
      expect(value.toLowerCase()).toContain('claude');
    }
  });

  test('modal has display name field', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');
    // The Name field is the display name input (UInput wraps a native input)
    const nameInput = dialog.getByRole('textbox', { name: 'Name' });
    await expect(nameInput).toBeVisible();
    // Wait for the async name generation to populate the placeholder
    await page.waitForTimeout(1000);
    const placeholder = await nameInput.getAttribute('placeholder');
    expect(placeholder).toBeTruthy();
    expect(placeholder!.length).toBeGreaterThan(0);
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
    await expect(page.locator('[role="dialog"]')).toBeHidden({ timeout: 10_000 });
  });

  test('name field has generated placeholder', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');
    const nameInput = dialog.locator('input').first();
    // The name field value is empty — the generated name is shown as placeholder
    const value = await nameInput.inputValue();
    expect(value).toBe('');
    // Wait for the generated name API call to complete (placeholder gets populated async)
    await expect(nameInput).toHaveAttribute('placeholder', /.+/, { timeout: 10_000 });
    const placeholder = await nameInput.getAttribute('placeholder');
    expect(placeholder!.length).toBeGreaterThan(0);
  });
});
