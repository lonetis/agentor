import { test, expect } from '@playwright/test';
import { goToDashboard } from '../helpers/ui-helpers';
import { ApiClient } from '../helpers/api-client';

test.describe('Init Scripts Modal — CRUD Operations', () => {

  test('create a custom script via the UI with #!/bin/bash pre-fill', async ({ page, request }) => {
    const api = new ApiClient(request);
    await goToDashboard(page);
    await page.locator('button:has-text("Init Scripts")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    const scriptName = `ui-script-create-${Date.now()}`;

    await dialog.locator('button:has-text("New")').click();
    await expect(dialog.locator('input[placeholder="Script name"]')).toBeVisible({ timeout: 5_000 });

    // Verify the textarea is pre-filled with #!/bin/bash
    const textarea = dialog.locator('textarea');
    const prefillValue = await textarea.inputValue();
    expect(prefillValue).toContain('#!/bin/bash');

    await dialog.locator('input[placeholder="Script name"]').fill(scriptName);
    await textarea.fill('#!/bin/bash\necho "Hello from custom script"');

    await dialog.locator('button:has-text("Create")').click();

    await expect(dialog.locator('button:has-text("New")')).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText(scriptName)).toBeVisible({ timeout: 10_000 });

    const scriptRow = dialog.locator('.rounded-lg').filter({ hasText: scriptName });
    await expect(scriptRow.locator('button:has-text("Edit")')).toBeVisible({ timeout: 5_000 });
    await expect(scriptRow.locator('button:has-text("Delete")')).toBeVisible({ timeout: 5_000 });

    // Cleanup
    const { body: scripts } = await api.listInitScripts();
    const created = scripts.find((s: { name: string }) => s.name === scriptName);
    if (created) await api.deleteInitScript(created.id);
  });

  test('edit a custom script', async ({ page, request }) => {
    const api = new ApiClient(request);
    const scriptName = `ui-script-edit-${Date.now()}`;
    const originalContent = '#!/bin/bash\necho "original"';
    const { body: created } = await api.createInitScript({ name: scriptName, content: originalContent });
    const scriptId = created.id;

    try {
      await goToDashboard(page);
      await page.locator('button:has-text("Init Scripts")').click();
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5_000 });

      await expect(dialog.getByText(scriptName)).toBeVisible({ timeout: 10_000 });

      const scriptRow = dialog.locator('.rounded-lg').filter({ hasText: scriptName });
      await scriptRow.locator('button:has-text("Edit")').click();

      const nameInput = dialog.locator('input[placeholder="Script name"]');
      await expect(nameInput).toBeVisible({ timeout: 5_000 });
      await expect(nameInput).toHaveValue(scriptName);

      const textarea = dialog.locator('textarea');
      await expect(textarea).toHaveValue(originalContent);

      const updatedContent = '#!/bin/bash\necho "updated"';
      await textarea.fill(updatedContent);

      const updateButton = dialog.locator('button:has-text("Update")');
      await expect(updateButton).toBeVisible();
      await expect(updateButton).toBeEnabled();
      await updateButton.click();

      await expect(dialog.locator('button:has-text("New")')).toBeVisible({ timeout: 10_000 });
      await expect(dialog.getByText(scriptName)).toBeVisible({ timeout: 10_000 });
    } finally {
      try { await api.deleteInitScript(scriptId); } catch { /* ignore */ }
    }
  });

  test('delete a custom script', async ({ page, request }) => {
    const api = new ApiClient(request);
    const scriptName = `ui-script-delete-${Date.now()}`;
    await api.createInitScript({ name: scriptName, content: '#!/bin/bash\necho "to delete"' });

    await goToDashboard(page);
    await page.locator('button:has-text("Init Scripts")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await expect(dialog.getByText(scriptName)).toBeVisible({ timeout: 10_000 });

    const scriptRow = dialog.locator('.rounded-lg').filter({ hasText: scriptName });
    await scriptRow.locator('button:has-text("Delete")').click();

    await expect(dialog.getByText(scriptName)).toBeHidden({ timeout: 10_000 });

    // Built-in scripts should still be visible
    await expect(dialog.getByText('claude', { exact: true })).toBeVisible({ timeout: 5_000 });
  });

  test('view a built-in script (read-only)', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Init Scripts")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    const builtInRow = dialog.locator('.rounded-lg').filter({ hasText: 'claude' }).first();
    await expect(builtInRow).toBeVisible({ timeout: 10_000 });
    await builtInRow.locator('button:has-text("View")').click();

    const nameInput = dialog.locator('input').first();
    await expect(nameInput).toBeVisible({ timeout: 5_000 });
    await expect(nameInput).toBeDisabled();

    const textarea = dialog.locator('textarea');
    await expect(textarea).toBeDisabled();

    const content = await textarea.inputValue();
    expect(content.length).toBeGreaterThan(0);

    await expect(dialog.locator('button:has-text("Create")')).toBeHidden();
    await expect(dialog.locator('button:has-text("Update")')).toBeHidden();

    const closeBtn = dialog.locator('div.flex.gap-3 button:has-text("Close")');
    await expect(closeBtn).toBeVisible();
  });

  test('built-in scripts show "Built-in" badge', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Init Scripts")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    const builtInScripts = ['claude', 'codex', 'gemini'];
    for (const name of builtInScripts) {
      const row = dialog.locator('.rounded-lg').filter({ hasText: name });
      await expect(row.first()).toBeVisible({ timeout: 10_000 });
      await expect(row.first().getByText('Built-in')).toBeVisible();
    }
  });

  test('save button is disabled when name is empty', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Init Scripts")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await dialog.locator('button:has-text("New")').click();
    await expect(dialog.locator('input[placeholder="Script name"]')).toBeVisible({ timeout: 5_000 });

    const createButton = dialog.locator('button:has-text("Create")');
    await expect(createButton).toBeDisabled();
  });

  test('save button is disabled when content is empty', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Init Scripts")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await dialog.locator('button:has-text("New")').click();
    await expect(dialog.locator('input[placeholder="Script name"]')).toBeVisible({ timeout: 5_000 });

    await dialog.locator('input[placeholder="Script name"]').fill('test-script');
    await dialog.locator('textarea').fill('');

    const createButton = dialog.locator('button:has-text("Create")');
    await expect(createButton).toBeDisabled();
  });

  test('save button becomes enabled when both fields are filled', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Init Scripts")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await dialog.locator('button:has-text("New")').click();
    await expect(dialog.locator('input[placeholder="Script name"]')).toBeVisible({ timeout: 5_000 });

    const createButton = dialog.locator('button:has-text("Create")');
    await expect(createButton).toBeDisabled();

    await dialog.locator('input[placeholder="Script name"]').fill('test-script');

    await expect(createButton).toBeEnabled();
  });
});
