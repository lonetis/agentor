import { test, expect } from '@playwright/test';
import { goToDashboard, openEnvironmentsModal } from '../helpers/ui-helpers';
import { ApiClient } from '../helpers/api-client';

test.describe('Environments Modal', () => {
  test('opens when clicking Environments button', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    await expect(page.locator('[role="dialog"]')).toBeVisible();
  });

  test('can close the modal with Escape', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('[role="dialog"]')).toBeHidden({ timeout: 5000 });
  });

  test('shows pre-created environments', async ({ page, request }) => {
    // Create an environment via API first
    const api = new ApiClient(request);
    const envName = `UIEnv-${Date.now()}`;
    const { body } = await api.createEnvironment({ name: envName });

    try {
      await goToDashboard(page);
      await openEnvironmentsModal(page);

      // The environment name should appear in the modal
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog.getByText(envName)).toBeVisible({ timeout: 10_000 });
    } finally {
      // Clean up only this specific environment
      try { await api.deleteEnvironment(body.id); } catch { /* ignore */ }
    }
  });

  test('modal has New button', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog.getByRole('button', { name: 'New', exact: true })).toBeVisible();
  });

  test('clicking New shows environment form', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByRole('button', { name: 'New', exact: true }).click();
    // The form should show a Name input
    await expect(dialog.getByText('Name', { exact: true })).toBeVisible({ timeout: 5_000 });
  });

  test('environment form shows network access fieldset', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByRole('button', { name: 'New', exact: true }).click();
    // Network mode uses a fieldset with legend "Network Access"
    await expect(dialog.getByText('Network Access')).toBeVisible({ timeout: 5_000 });
  });

  test('environment form shows Docker toggle', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByRole('button', { name: 'New', exact: true }).click();
    // Docker section uses checkbox with label "Enable Docker-in-Docker"
    await expect(dialog.getByText('Docker-in-Docker')).toBeVisible({ timeout: 5_000 });
  });

  test('environment form shows resource limit fields', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByRole('button', { name: 'New', exact: true }).click();
    // CPU and Memory labels
    await expect(dialog.getByText('CPU', { exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText('Memory', { exact: true })).toBeVisible({ timeout: 5_000 });
  });

  test('environment form shows Setup Script textarea', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByRole('button', { name: 'New', exact: true }).click();
    await expect(dialog.getByText('Setup Script')).toBeVisible({ timeout: 5_000 });
  });

  test('environment form has Create button', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByRole('button', { name: 'New', exact: true }).click();
    await expect(dialog.locator('button:has-text("Create")')).toBeVisible({ timeout: 5_000 });
  });

  test('environment list shows Default built-in environment with Built-in badge', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');

    // The default environment row should contain "Default" and a "Built-in" badge
    const defaultRow = dialog.locator('.rounded-lg').filter({ hasText: 'Default' });
    await expect(defaultRow).toBeVisible({ timeout: 5_000 });
    await expect(defaultRow.getByText('Built-in')).toBeVisible();
  });

  test('built-in environment has View button and no Edit or Delete buttons', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');

    // Find the row for the Default (built-in) environment
    const defaultRow = dialog.locator('.rounded-lg').filter({ hasText: 'Default' }).filter({ hasText: 'Built-in' });
    await expect(defaultRow).toBeVisible({ timeout: 5_000 });

    // Built-in environments show "View", not "Edit" or "Delete"
    await expect(defaultRow.locator('button:has-text("View")')).toBeVisible();
    await expect(defaultRow.locator('button:has-text("Edit")')).toBeHidden();
    await expect(defaultRow.locator('button:has-text("Delete")')).toBeHidden();
  });

  test('New button opens editor with empty form', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByRole('button', { name: 'New', exact: true }).click();

    // Name input should be present and empty
    const nameInput = dialog.locator('input[placeholder="My environment"]');
    await expect(nameInput).toBeVisible({ timeout: 5_000 });
    await expect(nameInput).toHaveValue('');

    // Create button should be visible (not Update)
    await expect(dialog.locator('button:has-text("Create")')).toBeVisible();
    await expect(dialog.locator('button:has-text("Update")')).toBeHidden();
  });

  test('editor has Expose APIs section with three checkboxes', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByRole('button', { name: 'New', exact: true }).click();

    // The "Expose APIs" fieldset legend
    await expect(dialog.getByText('Expose APIs')).toBeVisible({ timeout: 5_000 });

    // Three checkboxes: Port Mappings, Domain Mappings, Usage Monitoring
    await expect(dialog.getByText('Port Mappings')).toBeVisible();
    await expect(dialog.getByText('Domain Mappings')).toBeVisible();
    await expect(dialog.getByText('Usage Monitoring')).toBeVisible();
  });

  test('editor has Skills section with checkboxes', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByRole('button', { name: 'New', exact: true }).click();

    // Skills fieldset with Select All toggle
    await expect(dialog.getByText('Skills').first()).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText('Select All').first()).toBeVisible();
  });

  test('editor has AGENTS.md section with checkboxes', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByRole('button', { name: 'New', exact: true }).click();

    // AGENTS.md fieldset
    await expect(dialog.getByText('AGENTS.md').first()).toBeVisible({ timeout: 5_000 });
  });

  test('editor has Environment Variables section', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByRole('button', { name: 'New', exact: true }).click();

    // Environment Variables fieldset legend
    await expect(dialog.getByText('Environment Variables')).toBeVisible({ timeout: 5_000 });

    // Custom env vars textarea should be present with KEY=VALUE placeholder
    const envTextarea = dialog.locator('textarea[placeholder*="MY_VAR"]');
    await expect(envTextarea).toBeVisible();
  });

  test('editor has Setup Script textarea', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByRole('button', { name: 'New', exact: true }).click();

    // Setup Script label
    await expect(dialog.getByText('Setup Script')).toBeVisible({ timeout: 5_000 });

    // Textarea with bash placeholder
    const scriptTextarea = dialog.locator('textarea[placeholder*="#!/bin/bash"]');
    await expect(scriptTextarea).toBeVisible();
  });

  test('clicking Cancel in editor returns to list view', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');

    // Open editor
    await dialog.getByRole('button', { name: 'New', exact: true }).click();
    await expect(dialog.getByText('Expose APIs')).toBeVisible({ timeout: 5_000 });

    // Click Cancel
    await dialog.locator('button:has-text("Cancel")').click();

    // Should return to list view: "New" button visible again, editor sections gone
    await expect(dialog.locator('button:has-text("New")').first()).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText('Expose APIs')).toBeHidden();
  });

  test('View on built-in environment shows read-only form without Create/Update buttons', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');

    // Click "View" on the Default built-in environment
    const defaultRow = dialog.locator('.rounded-lg').filter({ hasText: 'Default' }).filter({ hasText: 'Built-in' });
    await expect(defaultRow).toBeVisible({ timeout: 5_000 });
    await defaultRow.locator('button:has-text("View")').click();

    // Editor should be visible with the environment name
    const nameInput = dialog.locator('input[placeholder="My environment"]');
    await expect(nameInput).toBeVisible({ timeout: 5_000 });

    // Name input should be disabled (read-only mode)
    await expect(nameInput).toBeDisabled();

    // Create and Update buttons should NOT be visible in read-only mode
    await expect(dialog.locator('button:has-text("Create")')).toBeHidden();
    await expect(dialog.locator('button:has-text("Update")')).toBeHidden();

    // Close button should be visible instead of Cancel (use .last() to skip dialog header close button)
    await expect(dialog.locator('button').filter({ hasText: /^Close$/ }).last()).toBeVisible();
  });
});
