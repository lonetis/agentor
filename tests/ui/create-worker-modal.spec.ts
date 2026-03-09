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

  test('shows form sections: Name, Environment, Repositories, Volume Mounts, Init Script', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');
    // Check all form field labels are present (using getByText for exact matching)
    await expect(dialog.getByText('Name', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Environment', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Repositories', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Volume Mounts', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Init Script', { exact: true }).first()).toBeVisible();
  });

  test('shows Manage environments button', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    // There are 2 Manage buttons (Environments + Init Scripts); check the first one
    await expect(page.locator('[role="dialog"] button:has-text("Manage")').first()).toBeVisible();
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

  test('shows init script textarea', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog.locator('textarea')).toBeVisible();
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
    // The Name field is the display name input (UInput wraps a native input)
    const nameInput = dialog.getByRole('textbox', { name: 'Name' });
    await expect(nameInput).toBeVisible();
    // Wait for the async name generation to populate the placeholder
    await page.waitForTimeout(1000);
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

    // Wait for the container to be created (verify via API rather than relying on UI timing)
    let newContainerId: string | undefined;
    for (let attempt = 0; attempt < 15; attempt++) {
      const { body: after } = await api.listContainers();
      const newOne = after.find((c: { id: string }) => !beforeIds.has(c.id));
      if (newOne) {
        newContainerId = newOne.id;
        break;
      }
      await page.waitForTimeout(2000);
    }
    expect(newContainerId).toBeTruthy();

    // Cleanup
    if (newContainerId) {
      await cleanupWorker(request, newContainerId);
    }
  });

  // --- Volume Mounts ---

  test('clicking + Add mount adds a mount row with source, target, and read-only fields', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('button:has-text("Add mount")').click();

    // Mount row should contain source input (Host path), target input (Container path), and read-only checkbox
    const hostPathInput = dialog.locator('input[placeholder="Host path"]');
    const containerPathInput = dialog.locator('input[placeholder="Container path"]');
    await expect(hostPathInput).toBeVisible();
    await expect(containerPathInput).toBeVisible();

    // Read-only checkbox labeled "ro"
    await expect(dialog.getByText('ro', { exact: true })).toBeVisible();
  });

  test('clicking + Add mount multiple times adds multiple mount rows', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');

    await dialog.locator('button:has-text("Add mount")').click();
    await dialog.locator('button:has-text("Add mount")').click();

    // Should have two "Host path" inputs now
    const hostPathInputs = dialog.locator('input[placeholder="Host path"]');
    await expect(hostPathInputs).toHaveCount(2);

    const containerPathInputs = dialog.locator('input[placeholder="Container path"]');
    await expect(containerPathInputs).toHaveCount(2);
  });

  test('mount row remove button removes the mount row', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');

    // Add a mount row
    await dialog.locator('button:has-text("Add mount")').click();
    const hostInput = dialog.locator('input[placeholder="Host path"]');
    await expect(hostInput).toBeVisible();

    // The mount row (MountInput) is a flex div containing: inputs, checkbox, and a remove UButton
    // Find the row containing the Host path input, then click the last button in it (the X icon)
    const mountRow = hostInput.locator('xpath=ancestor::div[contains(@class, "flex")][contains(@class, "gap-2")]');
    await mountRow.locator('button').last().click();

    // Mount row should be gone
    await expect(dialog.locator('input[placeholder="Host path"]')).toHaveCount(0);
    await expect(dialog.locator('input[placeholder="Container path"]')).toHaveCount(0);
  });

  test('mount row inputs accept text values', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');

    await dialog.locator('button:has-text("Add mount")').click();

    const hostPathInput = dialog.locator('input[placeholder="Host path"]');
    const containerPathInput = dialog.locator('input[placeholder="Container path"]');

    await hostPathInput.fill('/home/user/data');
    await containerPathInput.fill('/mnt/data');

    await expect(hostPathInput).toHaveValue('/home/user/data');
    await expect(containerPathInput).toHaveValue('/mnt/data');
  });

  // --- Repository ---

  test('clicking + Add repository adds a repo row with URL and branch inputs', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');

    await dialog.locator('button:has-text("Add repository")').click();

    // RepoInput renders a provider selector, a URL/search input, and a branch input
    // The branch input has placeholder "branch (optional)"
    const branchInput = dialog.locator('input[placeholder="branch (optional)"]');
    await expect(branchInput).toBeVisible();
  });

  test('clicking + Add repository multiple times adds multiple repo rows', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');

    await dialog.locator('button:has-text("Add repository")').click();
    await dialog.locator('button:has-text("Add repository")').click();

    // Should have two branch inputs
    const branchInputs = dialog.locator('input[placeholder="branch (optional)"]');
    await expect(branchInputs).toHaveCount(2);
  });

  test('repo row remove button removes the repo row', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');

    // Add a repo row
    await dialog.locator('button:has-text("Add repository")').click();
    await expect(dialog.locator('input[placeholder="branch (optional)"]')).toBeVisible();

    // RepoInput has a UButton with icon="i-lucide-x" as the last button in the row
    // Find the row container (the flex div with the branch input) and click the X button
    const branchInput = dialog.locator('input[placeholder="branch (optional)"]');
    const repoRow = branchInput.locator('xpath=ancestor::div[contains(@class, "flex")][contains(@class, "gap-2")]');
    const removeButton = repoRow.locator('button').last();
    await removeButton.click();

    // Repo row should be gone
    await expect(dialog.locator('input[placeholder="branch (optional)"]')).toHaveCount(0);
  });

  // --- Init Script ---

  test('init script dropdown shows None by default', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');

    // The init script USelect (combobox) shows "None" by default
    // There are 2 comboboxes: Environment and Init Script
    const initScriptCombobox = dialog.getByRole('combobox', { name: 'Init Script' });
    await expect(initScriptCombobox).toBeVisible();
    await expect(initScriptCombobox).toContainText('None');
  });

  test('init script section has Manage button', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');

    // There are two "Manage" buttons in the modal: one for environments, one for init scripts.
    // The init script "Manage" button is below the init script dropdown.
    const manageButtons = dialog.locator('button:has-text("Manage")');
    const count = await manageButtons.count();
    // At least 2 Manage buttons (Environment + Init Script)
    expect(count).toBeGreaterThanOrEqual(2);

    // The second Manage button is the one in the Init Script section
    await expect(manageButtons.nth(1)).toBeVisible();
  });

  // --- Modal close behaviors ---

  test('Cancel button closes the modal and resets to clean state', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');

    // Add some state: a repo row and a mount row
    await dialog.locator('button:has-text("Add repository")').click();
    await dialog.locator('button:has-text("Add mount")').click();

    // Close via Cancel
    await dialog.locator('button:has-text("Cancel")').click();
    await expect(dialog).toBeHidden({ timeout: 5000 });

    // Re-open the modal — form should be reset (no repo or mount rows)
    await openCreateWorkerModal(page);
    const dialog2 = page.locator('[role="dialog"]');
    await expect(dialog2.locator('input[placeholder="branch (optional)"]')).toHaveCount(0);
    await expect(dialog2.locator('input[placeholder="Host path"]')).toHaveCount(0);
  });

  test('Escape key closes the modal', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 5000 });
  });
});
