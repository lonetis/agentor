import { test, expect } from '@playwright/test';
import { goToDashboard } from '../helpers/ui-helpers';
import { ApiClient } from '../helpers/api-client';

test.describe('Instructions Modal — CRUD Operations', () => {

  test('create a custom entry via the UI', async ({ page, request }) => {
    const api = new ApiClient(request);
    await goToDashboard(page);
    await page.locator('button:has-text("Instructions")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    const entryName = `ui-entry-create-${Date.now()}`;
    const entryContent = '# UI Test Entry\n\nThis is test content for AGENTS.md.';

    await dialog.locator('button:has-text("New")').click();
    await expect(dialog.locator('input[placeholder="Entry name"]')).toBeVisible({ timeout: 5_000 });

    await dialog.locator('input[placeholder="Entry name"]').fill(entryName);
    await dialog.locator('textarea').fill(entryContent);

    await dialog.locator('button:has-text("Create")').click();

    await expect(dialog.locator('button:has-text("New")')).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText(entryName)).toBeVisible({ timeout: 10_000 });

    const entryRow = dialog.locator('.rounded-lg').filter({ hasText: entryName });
    await expect(entryRow.locator('button:has-text("Edit")')).toBeVisible({ timeout: 5_000 });
    await expect(entryRow.locator('button:has-text("Delete")')).toBeVisible({ timeout: 5_000 });

    // Cleanup
    const { body: entries } = await api.listInstructions();
    const created = entries.find((e: { name: string }) => e.name === entryName);
    if (created) await api.deleteInstruction(created.id);
  });

  test('edit a custom entry', async ({ page, request }) => {
    const api = new ApiClient(request);
    const entryName = `ui-entry-edit-${Date.now()}`;
    const originalContent = '# Original\n\nOriginal content.';
    const { body: created } = await api.createInstruction({ name: entryName, content: originalContent });
    const entryId = created.id;

    try {
      await goToDashboard(page);
      await page.locator('button:has-text("Instructions")').click();
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5_000 });

      await expect(dialog.getByText(entryName)).toBeVisible({ timeout: 10_000 });

      const entryRow = dialog.locator('.rounded-lg').filter({ hasText: entryName });
      await entryRow.locator('button:has-text("Edit")').click();

      const nameInput = dialog.locator('input[placeholder="Entry name"]');
      await expect(nameInput).toBeVisible({ timeout: 5_000 });
      await expect(nameInput).toHaveValue(entryName);

      const updatedContent = '# Updated\n\nUpdated content.';
      await dialog.locator('textarea').fill(updatedContent);

      const updateButton = dialog.locator('button:has-text("Update")');
      await expect(updateButton).toBeVisible();
      await expect(updateButton).toBeEnabled();
      await updateButton.click();

      await expect(dialog.locator('button:has-text("New")')).toBeVisible({ timeout: 10_000 });
      await expect(dialog.getByText(entryName)).toBeVisible({ timeout: 10_000 });
    } finally {
      try { await api.deleteInstruction(entryId); } catch { /* ignore */ }
    }
  });

  test('delete a custom entry', async ({ page, request }) => {
    const api = new ApiClient(request);
    const entryName = `ui-entry-delete-${Date.now()}`;
    await api.createInstruction({ name: entryName, content: '# To Delete\n\nContent.' });

    await goToDashboard(page);
    await page.locator('button:has-text("Instructions")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await expect(dialog.getByText(entryName)).toBeVisible({ timeout: 10_000 });

    const entryRow = dialog.locator('.rounded-lg').filter({ hasText: entryName });
    await entryRow.locator('button:has-text("Delete")').click();

    await expect(dialog.getByText(entryName)).toBeHidden({ timeout: 10_000 });

    const builtInBadges = dialog.getByText('Built-in');
    await expect(builtInBadges.first()).toBeVisible({ timeout: 5_000 });
  });

  test('view a built-in entry (read-only)', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Instructions")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    const builtInRow = dialog.locator('.rounded-lg').filter({ hasText: 'Built-in' }).first();
    await expect(builtInRow).toBeVisible({ timeout: 10_000 });
    await builtInRow.locator('button:has-text("View")').click();

    const nameInput = dialog.locator('input[placeholder="Entry name"]');
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
    await page.locator('button:has-text("Instructions")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await dialog.locator('button:has-text("New")').click();
    await expect(dialog.locator('input[placeholder="Entry name"]')).toBeVisible({ timeout: 5_000 });

    await dialog.locator('textarea').fill('Some content');

    const createButton = dialog.locator('button:has-text("Create")');
    await expect(createButton).toBeDisabled();
  });

  test('save button is disabled when content is empty', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Instructions")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await dialog.locator('button:has-text("New")').click();
    await expect(dialog.locator('input[placeholder="Entry name"]')).toBeVisible({ timeout: 5_000 });

    await dialog.locator('input[placeholder="Entry name"]').fill('test-entry');

    const createButton = dialog.locator('button:has-text("Create")');
    await expect(createButton).toBeDisabled();
  });

  test('save button becomes enabled when both fields are filled', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Instructions")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await dialog.locator('button:has-text("New")').click();
    await expect(dialog.locator('input[placeholder="Entry name"]')).toBeVisible({ timeout: 5_000 });

    const createButton = dialog.locator('button:has-text("Create")');
    await expect(createButton).toBeDisabled();

    await dialog.locator('input[placeholder="Entry name"]').fill('test-entry');
    await dialog.locator('textarea').fill('# Test\n\nContent.');

    await expect(createButton).toBeEnabled();
  });
});
