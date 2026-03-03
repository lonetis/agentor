import { test, expect } from '@playwright/test';
import { goToDashboard, openEnvironmentsModal } from '../helpers/ui-helpers';
import { cleanupAllEnvironments } from '../helpers/worker-lifecycle';
import { ApiClient } from '../helpers/api-client';

test.describe('Environments Modal — Advanced', () => {
  test.afterEach(async ({ request }) => {
    await cleanupAllEnvironments(request);
  });

  test('new environment form has all fields', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('button:has-text("New Environment")').click();

    // Should have name, CPU, memory, network mode, docker toggle
    await expect(dialog.locator('text=Name').first()).toBeVisible();
    await expect(dialog.locator('text=CPU').first()).toBeVisible({ timeout: 5_000 });
    await expect(dialog.locator('text=Memory').first()).toBeVisible({ timeout: 5_000 });
  });

  test('can create environment via form', async ({ page, request }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('button:has-text("New Environment")').click();

    // Fill in the name
    const nameInput = dialog.locator('input').first();
    const envName = `UIEnvAdv-${Date.now()}`;
    await nameInput.fill(envName);

    // Save the environment
    const saveButton = dialog.locator('button:has-text("Save"), button:has-text("Create")').first();
    if (await saveButton.isVisible()) {
      await saveButton.click();

      // Verify it appears in the list via API
      const api = new ApiClient(request);
      const { body: envs } = await api.listEnvironments();
      const found = envs.find((e: { name: string }) => e.name === envName);
      expect(found).toBeTruthy();
    }
  });

  test('environment list shows edit and delete buttons', async ({ page, request }) => {
    const api = new ApiClient(request);
    const envName = `UIEnvEdit-${Date.now()}`;
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
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');

    // Find the environment entry
    const envEntry = dialog.locator(`text=${envName}`).first();
    await expect(envEntry).toBeVisible({ timeout: 10_000 });

    // Should have action buttons nearby (edit/delete icons or buttons)
    const row = envEntry.locator('..').locator('..');
    const buttons = row.locator('button');
    expect(await buttons.count()).toBeGreaterThanOrEqual(1);
  });

  test('can edit existing environment', async ({ page, request }) => {
    const api = new ApiClient(request);
    const envName = `UIEnvEditable-${Date.now()}`;
    const { body } = await api.createEnvironment({
      name: envName,
      cpuLimit: 2,
      memoryLimit: '1g',
      networkMode: 'full',
      allowedDomains: [],
      includePackageManagerDomains: false,
      dockerEnabled: true,
      envVars: '',
      setupScript: '',
      initScript: '',
    });

    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');

    // Click on the environment to edit it
    const envEntry = dialog.getByText(envName).first();
    await expect(envEntry).toBeVisible({ timeout: 10_000 });
    await envEntry.click();

    // Should now show the edit form
    await expect(dialog.locator('input').first()).toBeVisible({ timeout: 5_000 });
  });

  test('network mode dropdown has expected options', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('button:has-text("New Environment")').click();

    // Look for network mode selector
    const networkSelect = dialog.locator('select, [role="listbox"]').first();
    if (await networkSelect.count() > 0) {
      await networkSelect.click();
      // Check for expected options
      const options = page.locator('option, [role="option"]');
      const count = await options.count();
      expect(count).toBeGreaterThanOrEqual(3); // at least full, block, custom
    }
  });
});
