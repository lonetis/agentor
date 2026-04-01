import { test, expect } from '@playwright/test';
import { goToDashboard } from '../helpers/ui-helpers';
import { ApiClient } from '../helpers/api-client';

test.describe('Capabilities Modal — CRUD Operations', () => {

  test('create a custom capability via the UI', async ({ page, request }) => {
    const api = new ApiClient(request);
    await goToDashboard(page);
    await page.locator('button:has-text("Capabilities")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    const capabilityName = `ui-capability-create-${Date.now()}`;
    const capabilityContent = '---\ndescription: A test capability created via UI\n---\n\nThis is the capability content.';

    await dialog.locator('button:has-text("New")').click();
    await expect(dialog.locator('input[placeholder="Capability name"]')).toBeVisible({ timeout: 5_000 });

    await dialog.locator('input[placeholder="Capability name"]').fill(capabilityName);
    await dialog.locator('textarea').fill(capabilityContent);

    await dialog.locator('button:has-text("Create")').click();

    // Should return to list view and show the new capability
    await expect(dialog.locator('button:has-text("New")')).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText(capabilityName)).toBeVisible({ timeout: 10_000 });

    // The new capability should have Edit and Delete buttons
    const capabilityRow = dialog.locator('.rounded-lg').filter({ hasText: capabilityName });
    await expect(capabilityRow.locator('button:has-text("Edit")')).toBeVisible({ timeout: 5_000 });

    // Cleanup: delete the capability we just created
    const { body: capabilities } = await api.listCapabilities();
    const created = capabilities.find((s: { name: string }) => s.name === capabilityName);
    if (created) await api.deleteCapability(created.id);
  });

  test('edit a custom capability', async ({ page, request }) => {
    const api = new ApiClient(request);
    const capabilityName = `ui-capability-edit-${Date.now()}`;
    const originalContent = '---\ndescription: Original\n---\n\nOriginal content.';
    const { body: created } = await api.createCapability({ name: capabilityName, content: originalContent });
    const capabilityId = created.id;

    try {
      await goToDashboard(page);
      await page.locator('button:has-text("Capabilities")').click();
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5_000 });

      await expect(dialog.getByText(capabilityName)).toBeVisible({ timeout: 10_000 });

      const capabilityRow = dialog.locator('.rounded-lg').filter({ hasText: capabilityName });
      await capabilityRow.locator('button:has-text("Edit")').click();

      const nameInput = dialog.locator('input[placeholder="Capability name"]');
      await expect(nameInput).toBeVisible({ timeout: 5_000 });
      await expect(nameInput).toHaveValue(capabilityName);

      const updatedContent = '---\ndescription: Updated\n---\n\nUpdated content.';
      await dialog.locator('textarea').fill(updatedContent);

      const updateButton = dialog.locator('button:has-text("Update")');
      await expect(updateButton).toBeVisible();
      await expect(updateButton).toBeEnabled();
      await updateButton.click();

      // Should return to list
      await expect(dialog.locator('button:has-text("New")')).toBeVisible({ timeout: 10_000 });
      await expect(dialog.getByText(capabilityName)).toBeVisible({ timeout: 10_000 });
    } finally {
      // Cleanup
      try { await api.deleteCapability(capabilityId); } catch { /* ignore */ }
    }
  });

  test('delete a custom capability', async ({ page, request }) => {
    const api = new ApiClient(request);
    const capabilityName = `ui-capability-delete-${Date.now()}`;
    const { body: created } = await api.createCapability({ name: capabilityName, content: '---\ndescription: To delete\n---\n\nContent.' });

    await goToDashboard(page);
    await page.locator('button:has-text("Capabilities")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await expect(dialog.getByText(capabilityName)).toBeVisible({ timeout: 10_000 });

    const capabilityRow = dialog.locator('.rounded-lg').filter({ hasText: capabilityName });
    await capabilityRow.locator('button:has-text("Delete")').click();

    await expect(dialog.getByText(capabilityName)).toBeHidden({ timeout: 10_000 });

    // Built-in capabilities should still be visible
    await expect(dialog.getByText('tmux')).toBeVisible({ timeout: 5_000 });

    // No cleanup needed — capability already deleted via UI
  });

  test('view a built-in capability (read-only)', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Capabilities")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    const builtInRow = dialog.locator('.rounded-lg').filter({ hasText: 'tmux' });
    await expect(builtInRow).toBeVisible({ timeout: 10_000 });
    await builtInRow.locator('button:has-text("View")').click();

    const nameInput = dialog.locator('input[placeholder="Capability name"]');
    await expect(nameInput).toBeVisible({ timeout: 5_000 });
    await expect(nameInput).toBeDisabled();

    const textarea = dialog.locator('textarea');
    await expect(textarea).toBeDisabled();

    await expect(dialog.locator('button:has-text("Create")')).toBeHidden();
    await expect(dialog.locator('button:has-text("Update")')).toBeHidden();

    const closeBtn = dialog.locator('div.flex.gap-3 button:has-text("Close")');
    await expect(closeBtn).toBeVisible();
  });

  test('save button is disabled when name is empty', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Capabilities")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await dialog.locator('button:has-text("New")').click();
    await expect(dialog.locator('input[placeholder="Capability name"]')).toBeVisible({ timeout: 5_000 });

    await dialog.locator('textarea').fill('Some content');

    const createButton = dialog.locator('button:has-text("Create")');
    await expect(createButton).toBeDisabled();
  });

  test('save button is disabled when content is empty', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Capabilities")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await dialog.locator('button:has-text("New")').click();
    await expect(dialog.locator('input[placeholder="Capability name"]')).toBeVisible({ timeout: 5_000 });

    await dialog.locator('input[placeholder="Capability name"]').fill('test-capability');

    const createButton = dialog.locator('button:has-text("Create")');
    await expect(createButton).toBeDisabled();
  });

  test('save button becomes enabled when both name and content are filled', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Capabilities")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await dialog.locator('button:has-text("New")').click();
    await expect(dialog.locator('input[placeholder="Capability name"]')).toBeVisible({ timeout: 5_000 });

    const createButton = dialog.locator('button:has-text("Create")');
    await expect(createButton).toBeDisabled();

    await dialog.locator('input[placeholder="Capability name"]').fill('test-capability');
    await dialog.locator('textarea').fill('Some content');

    await expect(createButton).toBeEnabled();
  });
});
