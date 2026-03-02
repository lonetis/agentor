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

  test('modal has New Environment button', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog.locator('button:has-text("New Environment")')).toBeVisible();
  });

  test('clicking New Environment shows environment form', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('button:has-text("New Environment")').click();
    // The form should show a Name input
    await expect(dialog.getByText('Name', { exact: true })).toBeVisible({ timeout: 5_000 });
  });

  test('environment form shows network access fieldset', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('button:has-text("New Environment")').click();
    // Network mode uses a fieldset with legend "Network Access"
    await expect(dialog.getByText('Network Access')).toBeVisible({ timeout: 5_000 });
  });

  test('environment form shows Docker toggle', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('button:has-text("New Environment")').click();
    // Docker section uses checkbox with label "Enable Docker-in-Docker"
    await expect(dialog.getByText('Docker-in-Docker')).toBeVisible({ timeout: 5_000 });
  });

  test('environment form shows resource limit fields', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('button:has-text("New Environment")').click();
    // CPU and Memory labels
    await expect(dialog.getByText('CPU', { exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText('Memory', { exact: true })).toBeVisible({ timeout: 5_000 });
  });

  test('environment form shows Setup Script textarea', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('button:has-text("New Environment")').click();
    await expect(dialog.getByText('Setup Script')).toBeVisible({ timeout: 5_000 });
  });

  test('environment form shows Init Script section', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('button:has-text("New Environment")').click();
    await expect(dialog.getByText('Init Script').first()).toBeVisible({ timeout: 5_000 });
  });

  test('environment form has Create button', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('button:has-text("New Environment")').click();
    await expect(dialog.locator('button:has-text("Create")')).toBeVisible({ timeout: 5_000 });
  });
});
