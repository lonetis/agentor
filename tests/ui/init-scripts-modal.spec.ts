import { test, expect } from '@playwright/test';
import { goToDashboard } from '../helpers/ui-helpers';
import { ApiClient } from '../helpers/api-client';

test.describe('Init Scripts Modal', () => {
  test('Init Scripts button is visible and opens modal', async ({ page }) => {
    await goToDashboard(page);
    const btn = page.locator('button:has-text("Init Scripts")');
    await expect(btn).toBeVisible({ timeout: 10_000 });
    await btn.click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
  });

  test('modal has "Init Scripts" title', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Init Scripts")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog.locator('h2')).toHaveText('Init Scripts');
  });

  test('built-in scripts (claude, codex, gemini) are listed', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Init Scripts")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    const builtInScripts = ['claude', 'codex', 'gemini'];
    for (const name of builtInScripts) {
      await expect(dialog.getByText(name, { exact: true })).toBeVisible({ timeout: 10_000 });
    }
  });

  test('Close button closes the modal', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Init Scripts")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    await dialog.locator('button:has-text("Close")').click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
  });

  test('Escape key closes the modal', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Init Scripts")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 10_000 });
  });

  test('"New" button shows editor form', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Init Scripts")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    await dialog.locator('button:has-text("New")').click();

    // Editor form should show name input and script textarea
    await expect(dialog.locator('input').first()).toBeVisible({ timeout: 10_000 });
    await expect(dialog.locator('textarea')).toBeVisible({ timeout: 10_000 });
  });

  test('Cancel in editor returns to list view', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Init Scripts")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    await dialog.locator('button:has-text("New")').click();
    await expect(dialog.getByText('Name', { exact: true })).toBeVisible({ timeout: 10_000 });

    await dialog.locator('button:has-text("Cancel")').click();

    // Should return to list — "New" button visible again
    await expect(dialog.locator('button:has-text("New")')).toBeVisible({ timeout: 10_000 });
    // Built-in scripts should be visible
    await expect(dialog.getByText('claude', { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test('new script textarea is pre-filled with "#!/bin/bash"', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Init Scripts")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    await dialog.locator('button:has-text("New")').click();
    await expect(dialog.locator('textarea')).toBeVisible({ timeout: 10_000 });

    const textareaValue = await dialog.locator('textarea').inputValue();
    expect(textareaValue).toContain('#!/bin/bash');
  });

  test('create custom script flow', async ({ page, request }) => {
    const api = new ApiClient(request);
    const scriptName = `test-script-${Date.now()}`;

    try {
      await goToDashboard(page);
      await page.locator('button:has-text("Init Scripts")').click();
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 10_000 });

      await dialog.locator('button:has-text("New")').click();
      await expect(dialog.locator('input[placeholder="Script name"]')).toBeVisible({ timeout: 10_000 });

      await dialog.locator('input[placeholder="Script name"]').fill(scriptName);
      // Textarea is pre-filled with #!/bin/bash, add more content
      await dialog.locator('textarea').fill('#!/bin/bash\necho "Hello from test script"');

      await dialog.locator('button:has-text("Create")').click();

      // Should return to list and show the new script
      await expect(dialog.locator('button:has-text("New")')).toBeVisible({ timeout: 10_000 });
      await expect(dialog.getByText(scriptName)).toBeVisible({ timeout: 10_000 });
    } finally {
      // Cleanup: delete the init script we just created
      const { body: scripts } = await api.listInitScripts();
      const created = scripts.find((s: { name: string }) => s.name === scriptName);
      if (created) await api.deleteInitScript(created.id);
    }
  });
});
