import { test, expect } from '@playwright/test';
import { goToDashboard } from '../helpers/ui-helpers';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';

test.describe.serial('Workspace Upload Modal', () => {
  let containerId: string;
  let displayName: string;

  test.beforeAll(async ({ request }) => {
    displayName = `Upload-${Date.now()}`;
    const container = await createWorker(request, { displayName });
    containerId = container.id;
  });

  test.afterAll(async ({ request }) => {
    if (containerId) {
      await cleanupWorker(request, containerId);
    }
  });

  test('upload button is visible on running container', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    // The upload button has tooltip "Upload to Workspace" — it is the 5th icon button
    // It is a UButton wrapping an SVG (upload arrow icon)
    // All icon buttons are in the view buttons row (only visible when running)
    const iconButtons = card.locator('button');
    await expect(iconButtons.first()).toBeVisible();
    const count = await iconButtons.count();
    // Should have at least 6 icon buttons (Terminal, Desktop, Editor, Apps, Upload, Download)
    expect(count).toBeGreaterThanOrEqual(6);
  });

  test('clicking upload button opens upload modal', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    // The upload button is the 5th icon button (after Terminal, Desktop, Editor, Apps, spacer, Upload)
    // It has tooltip "Upload to Workspace" — find it by locating buttons with SVGs
    // The upload and download buttons are after a flex spacer, so we look for the upload icon
    // Click all icon buttons to find the one that opens the upload modal
    // The Upload button triggers showUpload = true which opens the UploadModal
    // We can find it by its position - it's the 5th icon button
    const iconButtons = card.locator('button');
    // Icon buttons order: Terminal(0), Desktop(1), Editor(2), Apps(3), Upload(4), Download(5)
    await iconButtons.nth(4).click();
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5_000 });
    // Verify it is the upload modal by checking the title
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog.locator('h2')).toContainText('Upload to Workspace');
  });

  test('upload modal shows container name', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    const iconButtons = card.locator('button');
    await iconButtons.nth(4).click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    // The modal description mentions the container name
    await expect(dialog.locator(`text=${displayName}`)).toBeVisible();
  });

  test('upload modal has drop zone', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    const iconButtons = card.locator('button');
    await iconButtons.nth(4).click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    // The FileDropZone shows "Drop files or folders here"
    await expect(dialog.locator('text=Drop files or folders')).toBeVisible();
  });

  test('upload modal has Upload and Cancel buttons', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    const iconButtons = card.locator('button');
    await iconButtons.nth(4).click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog.locator('button:has-text("Upload")')).toBeVisible();
    await expect(dialog.locator('button:has-text("Cancel")')).toBeVisible();
  });

  test('upload button is disabled when no files selected', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    const iconButtons = card.locator('button');
    await iconButtons.nth(4).click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    // The Upload button should be disabled when no files are selected
    const uploadBtn = dialog.locator('button:has-text("Upload")');
    await expect(uploadBtn).toBeDisabled();
  });

  test('upload modal can be closed with Cancel', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    const iconButtons = card.locator('button');
    await iconButtons.nth(4).click();
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5_000 });
    await page.click('[role="dialog"] button:has-text("Cancel")');
    await expect(page.locator('[role="dialog"]')).toBeHidden({ timeout: 5_000 });
  });

  test('upload modal can be closed with Escape', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    const iconButtons = card.locator('button');
    await iconButtons.nth(4).click();
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('[role="dialog"]')).toBeHidden({ timeout: 5_000 });
  });
});
