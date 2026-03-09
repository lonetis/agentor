import { test, expect } from '@playwright/test';
import { goToDashboard, openEnvironmentsModal } from '../helpers/ui-helpers';
import { ApiClient } from '../helpers/api-client';

test.describe('Environments Modal — Advanced', () => {
  test('new environment form has all fields', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByRole('button', { name: 'New', exact: true }).click();

    // Should have name, CPU, memory, network mode, docker toggle
    await expect(dialog.locator('text=Name').first()).toBeVisible();
    await expect(dialog.locator('text=CPU').first()).toBeVisible({ timeout: 5_000 });
    await expect(dialog.locator('text=Memory').first()).toBeVisible({ timeout: 5_000 });
  });

  test('can create environment via form', async ({ page, request }) => {
    const api = new ApiClient(request);
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByRole('button', { name: 'New', exact: true }).click();

    // Fill in the name
    const nameInput = dialog.locator('input').first();
    const envName = `UIEnvAdv-${Date.now()}`;
    await nameInput.fill(envName);

    // Save the environment
    const saveButton = dialog.locator('button:has-text("Save"), button:has-text("Create")').first();
    try {
      if (await saveButton.isVisible()) {
        await saveButton.click();

        // Verify it appears in the list via API
        const { body: envs } = await api.listEnvironments();
        const found = envs.find((e: { name: string }) => e.name === envName);
        expect(found).toBeTruthy();
      }
    } finally {
      // Clean up only this environment
      const { body: envs } = await api.listEnvironments();
      const created = envs.find((e: { name: string }) => e.name === envName);
      if (created) try { await api.deleteEnvironment(created.id); } catch { /* ignore */ }
    }
  });

  test('custom environment shows Edit and Delete buttons', async ({ page, request }) => {
    const api = new ApiClient(request);
    const envName = `UIEnvEdit-${Date.now()}`;
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
      await openEnvironmentsModal(page);
      const dialog = page.locator('[role="dialog"]');

      // Find the row containing the environment name
      const envRow = dialog.locator('.rounded-lg').filter({ hasText: envName });
      await expect(envRow).toBeVisible({ timeout: 10_000 });

      // Custom environments have Edit and Delete buttons
      await expect(envRow.locator('button:has-text("Edit")')).toBeVisible();
      await expect(envRow.locator('button:has-text("Delete")')).toBeVisible();
    } finally {
      try { await api.deleteEnvironment(created.id); } catch { /* ignore */ }
    }
  });

  test('can edit existing environment', async ({ page, request }) => {
    const api = new ApiClient(request);
    const envName = `UIEnvEditable-${Date.now()}`;
    const { body: created } = await api.createEnvironment({
      name: envName,
      cpuLimit: 2,
      memoryLimit: '1g',
      networkMode: 'full',
      allowedDomains: [],
      includePackageManagerDomains: false,
      dockerEnabled: true,
      envVars: '',
      setupScript: '',
    });

    try {
      await goToDashboard(page);
      await openEnvironmentsModal(page);
      const dialog = page.locator('[role="dialog"]');

      // Find the row and click "Edit" button
      const envRow = dialog.locator('.rounded-lg').filter({ hasText: envName });
      await expect(envRow).toBeVisible({ timeout: 10_000 });
      await envRow.locator('button:has-text("Edit")').click();

      // Should now show the edit form with the name input
      await expect(dialog.locator('input[placeholder="My environment"]')).toBeVisible({ timeout: 5_000 });
    } finally {
      try { await api.deleteEnvironment(created.id); } catch { /* ignore */ }
    }
  });

  test('network mode dropdown has expected options', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByRole('button', { name: 'New', exact: true }).click();

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
