import { test, expect } from '@playwright/test';
import { goToDashboard } from '../helpers/ui-helpers';
import { ApiClient } from '../helpers/api-client';

test.describe('Skills Modal — CRUD Operations', () => {

  test('create a custom skill via the UI', async ({ page, request }) => {
    const api = new ApiClient(request);
    await goToDashboard(page);
    await page.locator('button:has-text("Skills")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    const skillName = `ui-skill-create-${Date.now()}`;
    const skillContent = '---\ndescription: A test skill created via UI\n---\n\nThis is the skill content.';

    await dialog.locator('button:has-text("New")').click();
    await expect(dialog.locator('input[placeholder="Skill name"]')).toBeVisible({ timeout: 5_000 });

    await dialog.locator('input[placeholder="Skill name"]').fill(skillName);
    await dialog.locator('textarea').fill(skillContent);

    await dialog.locator('button:has-text("Create")').click();

    // Should return to list view and show the new skill
    await expect(dialog.locator('button:has-text("New")')).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText(skillName)).toBeVisible({ timeout: 10_000 });

    // The new skill should have Edit and Delete buttons
    const skillRow = dialog.locator('.rounded-lg').filter({ hasText: skillName });
    await expect(skillRow.locator('button:has-text("Edit")')).toBeVisible({ timeout: 5_000 });

    // Cleanup: delete the skill we just created
    const { body: skills } = await api.listSkills();
    const created = skills.find((s: { name: string }) => s.name === skillName);
    if (created) await api.deleteSkill(created.id);
  });

  test('edit a custom skill', async ({ page, request }) => {
    const api = new ApiClient(request);
    const skillName = `ui-skill-edit-${Date.now()}`;
    const originalContent = '---\ndescription: Original\n---\n\nOriginal content.';
    const { body: created } = await api.createSkill({ name: skillName, content: originalContent });
    const skillId = created.id;

    try {
      await goToDashboard(page);
      await page.locator('button:has-text("Skills")').click();
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5_000 });

      await expect(dialog.getByText(skillName)).toBeVisible({ timeout: 10_000 });

      const skillRow = dialog.locator('.rounded-lg').filter({ hasText: skillName });
      await skillRow.locator('button:has-text("Edit")').click();

      const nameInput = dialog.locator('input[placeholder="Skill name"]');
      await expect(nameInput).toBeVisible({ timeout: 5_000 });
      await expect(nameInput).toHaveValue(skillName);

      const updatedContent = '---\ndescription: Updated\n---\n\nUpdated content.';
      await dialog.locator('textarea').fill(updatedContent);

      const updateButton = dialog.locator('button:has-text("Update")');
      await expect(updateButton).toBeVisible();
      await expect(updateButton).toBeEnabled();
      await updateButton.click();

      // Should return to list
      await expect(dialog.locator('button:has-text("New")')).toBeVisible({ timeout: 10_000 });
      await expect(dialog.getByText(skillName)).toBeVisible({ timeout: 10_000 });
    } finally {
      // Cleanup
      try { await api.deleteSkill(skillId); } catch { /* ignore */ }
    }
  });

  test('delete a custom skill', async ({ page, request }) => {
    const api = new ApiClient(request);
    const skillName = `ui-skill-delete-${Date.now()}`;
    const { body: created } = await api.createSkill({ name: skillName, content: '---\ndescription: To delete\n---\n\nContent.' });

    await goToDashboard(page);
    await page.locator('button:has-text("Skills")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await expect(dialog.getByText(skillName)).toBeVisible({ timeout: 10_000 });

    const skillRow = dialog.locator('.rounded-lg').filter({ hasText: skillName });
    await skillRow.locator('button:has-text("Delete")').click();

    await expect(dialog.getByText(skillName)).toBeHidden({ timeout: 10_000 });

    // Built-in skills should still be visible
    await expect(dialog.getByText('tmux')).toBeVisible({ timeout: 5_000 });

    // No cleanup needed — skill already deleted via UI
  });

  test('view a built-in skill (read-only)', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Skills")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    const builtInRow = dialog.locator('.rounded-lg').filter({ hasText: 'tmux' });
    await expect(builtInRow).toBeVisible({ timeout: 10_000 });
    await builtInRow.locator('button:has-text("View")').click();

    const nameInput = dialog.locator('input[placeholder="Skill name"]');
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
    await page.locator('button:has-text("Skills")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await dialog.locator('button:has-text("New")').click();
    await expect(dialog.locator('input[placeholder="Skill name"]')).toBeVisible({ timeout: 5_000 });

    await dialog.locator('textarea').fill('Some content');

    const createButton = dialog.locator('button:has-text("Create")');
    await expect(createButton).toBeDisabled();
  });

  test('save button is disabled when content is empty', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Skills")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await dialog.locator('button:has-text("New")').click();
    await expect(dialog.locator('input[placeholder="Skill name"]')).toBeVisible({ timeout: 5_000 });

    await dialog.locator('input[placeholder="Skill name"]').fill('test-skill');

    const createButton = dialog.locator('button:has-text("Create")');
    await expect(createButton).toBeDisabled();
  });

  test('save button becomes enabled when both name and content are filled', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Skills")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await dialog.locator('button:has-text("New")').click();
    await expect(dialog.locator('input[placeholder="Skill name"]')).toBeVisible({ timeout: 5_000 });

    const createButton = dialog.locator('button:has-text("Create")');
    await expect(createButton).toBeDisabled();

    await dialog.locator('input[placeholder="Skill name"]').fill('test-skill');
    await dialog.locator('textarea').fill('Some content');

    await expect(createButton).toBeEnabled();
  });
});
