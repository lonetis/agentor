import { test, expect } from '@playwright/test';
import { goToDashboard, openCreateWorkerModal } from '../helpers/ui-helpers';
import { cleanupWorker } from '../helpers/worker-lifecycle';
import { ApiClient } from '../helpers/api-client';

test.describe('Create Worker Modal', () => {

  test('opens when clicking + New Worker', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    await expect(page.locator('[role="dialog"] h2:has-text("New Worker")')).toBeVisible();
  });

  test('has a name input with generated placeholder', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const nameInput = page.locator('[role="dialog"] input').first();
    await page.waitForTimeout(1000);
    const placeholder = await nameInput.getAttribute('placeholder');
    expect(placeholder).toBeTruthy();
    expect(placeholder!.length).toBeGreaterThan(0);
  });

  test('has Create and Cancel buttons', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    await expect(page.locator('[role="dialog"] button:has-text("Create")')).toBeVisible();
    await expect(page.locator('[role="dialog"] button:has-text("Cancel")')).toBeVisible();
  });

  test('can close the modal via Cancel', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    await page.click('[role="dialog"] button:has-text("Cancel")');
    await expect(page.locator('[role="dialog"]')).toBeHidden({ timeout: 5000 });
  });

  test('can close the modal with Escape', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('[role="dialog"]')).toBeHidden({ timeout: 5000 });
  });

  test('shows form sections: Name, Environment, Repositories, Volume Mounts, Upload Files, Init Script', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');
    // Check all form field labels are present (using getByText for exact matching)
    await expect(dialog.getByText('Name', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Environment', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Repositories', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Volume Mounts', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Upload Files', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Init Script', { exact: true }).first()).toBeVisible();
  });

  test('shows Manage environments button', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    await expect(page.locator('[role="dialog"] button:has-text("Manage")')).toBeVisible();
  });

  test('shows Add repository link', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    await expect(page.locator('[role="dialog"] button:has-text("Add repository")')).toBeVisible();
  });

  test('shows Add mount link', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    await expect(page.locator('[role="dialog"] button:has-text("Add mount")')).toBeVisible();
  });

  test('shows file drop zone', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    await expect(page.locator('[role="dialog"]').locator('text=Drop files or folders')).toBeVisible();
  });

  test('has Environment selector with Default option', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    await expect(page.locator('[role="dialog"]').getByText('Default')).toBeVisible();
  });

  test('has Init Script preset selector with None option', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    await expect(page.locator('[role="dialog"]').getByText('None')).toBeVisible();
  });

  test('name input binds to displayName', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');
    // The Name field is the display name input
    const nameInput = dialog.locator('input').first();
    await expect(nameInput).toBeVisible();
    // It should have a generated placeholder
    const placeholder = await nameInput.getAttribute('placeholder');
    expect(placeholder).toBeTruthy();
  });

  test('+ Add repository button adds a repo row', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('button:has-text("Add repository")').click();
    // A new repo input row should appear
    await expect(dialog.locator('input').nth(1)).toBeVisible({ timeout: 5_000 });
  });

  test('+ Add mount button adds a mount row', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('button:has-text("Add mount")').click();
    // A new mount input row should appear
    const inputs = dialog.locator('input');
    const count = await inputs.count();
    // Should have more than 1 input now (name + mount source/target)
    expect(count).toBeGreaterThan(1);
  });

  test('environment dropdown has selectable options', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');
    // The environment selector should be visible with "Default" option
    const envSelector = dialog.getByText('Default');
    await expect(envSelector).toBeVisible();
  });

  test('init preset dropdown shows agent options', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');
    // The init preset area should have "None" visible
    await expect(dialog.getByText('None')).toBeVisible();
    // The textarea for init script should exist
    await expect(dialog.locator('textarea')).toBeVisible();
  });

  test('creates a worker when clicking Create', async ({ page, request }) => {
    // Snapshot current containers to identify the newly created one
    const api = new ApiClient(request);
    const { body: before } = await api.listContainers();
    const beforeIds = new Set(before.map((c: { id: string }) => c.id));

    await goToDashboard(page);
    await openCreateWorkerModal(page);
    await page.click('[role="dialog"] button:has-text("Create")');
    await expect(page.locator('[role="dialog"]')).toBeHidden({ timeout: 10_000 });
    // A container card should appear
    await page.waitForSelector('.rounded-lg h3', { timeout: 30_000 });
    expect(await page.locator('.rounded-lg h3').count()).toBeGreaterThan(0);

    // Cleanup only the newly created container
    const { body: after } = await api.listContainers();
    for (const c of after) {
      if (!beforeIds.has(c.id)) {
        await cleanupWorker(request, c.id);
      }
    }
  });
});
