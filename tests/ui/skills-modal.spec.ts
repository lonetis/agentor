import { test, expect } from '@playwright/test';
import { goToDashboard } from '../helpers/ui-helpers';
import { cleanupAllCustomSkills } from '../helpers/worker-lifecycle';

test.describe('Skills Modal', () => {
  test.afterEach(async ({ request }) => {
    await cleanupAllCustomSkills(request);
  });

  test('Skills button is visible in sidebar and opens modal dialog', async ({ page }) => {
    await goToDashboard(page);
    const skillsBtn = page.locator('button:has-text("Skills")');
    await expect(skillsBtn).toBeVisible({ timeout: 10_000 });
    await skillsBtn.click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
  });

  test('modal has "Skills" title', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Skills")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog.locator('h2')).toHaveText('Skills');
  });

  test('modal has "New" and "Close" buttons', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Skills")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog.locator('button:has-text("New")')).toBeVisible();
    await expect(dialog.locator('button:has-text("Close")')).toBeVisible();
  });

  test('built-in skills are listed', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Skills")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    const builtInSkills = ['port-mapping', 'domain-mapping', 'usage', 'tmux'];
    for (const name of builtInSkills) {
      await expect(dialog.getByText(name, { exact: false })).toBeVisible({ timeout: 10_000 });
    }
  });

  test('built-in skills show "Built-in" badge', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Skills")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    const badges = dialog.getByText('Built-in');
    await expect(badges.first()).toBeVisible({ timeout: 10_000 });
    // There should be at least 4 built-in badges (one per built-in skill)
    expect(await badges.count()).toBeGreaterThanOrEqual(4);
  });

  test('Close button closes the modal', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Skills")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await dialog.locator('button:has-text("Close")').click();
    await expect(dialog).toBeHidden({ timeout: 5_000 });
  });

  test('Escape key closes the modal', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Skills")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 5_000 });
  });

  test('"New" button shows editor form with name input and content textarea', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Skills")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await dialog.locator('button:has-text("New")').click();

    // Editor should show Name field and Content field
    await expect(dialog.getByText('Name', { exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText('Content')).toBeVisible({ timeout: 5_000 });

    // Input and textarea should be present
    await expect(dialog.locator('input[placeholder="Skill name"]')).toBeVisible();
    await expect(dialog.locator('textarea')).toBeVisible();
  });

  test('Cancel in editor returns to list view', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Skills")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await dialog.locator('button:has-text("New")').click();
    await expect(dialog.getByText('Name', { exact: true })).toBeVisible({ timeout: 5_000 });

    await dialog.locator('button:has-text("Cancel")').click();

    // Should be back at the list — "New" button should be visible again
    await expect(dialog.locator('button:has-text("New")')).toBeVisible({ timeout: 5_000 });
    // Built-in skills should be visible again
    await expect(dialog.getByText('tmux')).toBeVisible({ timeout: 5_000 });
  });

  test('create flow: fill name + content, save, verify appears in list', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Skills")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    const skillName = `test-skill-${Date.now()}`;

    await dialog.locator('button:has-text("New")').click();
    await expect(dialog.locator('input[placeholder="Skill name"]')).toBeVisible({ timeout: 5_000 });

    await dialog.locator('input[placeholder="Skill name"]').fill(skillName);
    await dialog.locator('textarea').fill('---\ndescription: Test skill\n---\n\nTest content');

    await dialog.locator('button:has-text("Create")').click();

    // Should return to list and show the new skill
    await expect(dialog.locator('button:has-text("New")')).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText(skillName)).toBeVisible({ timeout: 10_000 });
  });
});
