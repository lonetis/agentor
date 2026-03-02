import { test, expect } from '@playwright/test';
import { goToDashboard, acceptNextConfirm } from '../helpers/ui-helpers';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';
import { ApiClient } from '../helpers/api-client';

// Use test.describe.serial to avoid parallel container creation
test.describe.serial('Container Card', () => {
  let containerId: string;
  let displayName: string;

  test.beforeAll(async ({ request }) => {
    displayName = `Card-${Date.now()}`;
    const container = await createWorker(request, { displayName });
    containerId = container.id;
  });

  test.afterAll(async ({ request }) => {
    if (containerId) {
      await cleanupWorker(request, containerId);
    }
    // Also clean up archived workers
    const api = new ApiClient(request);
    const { body: archived } = await api.listArchived();
    for (const w of archived) {
      try { await api.deleteArchivedWorker(w.name); } catch { /* ignore */ }
    }
  });

  test('shows container name in sidebar', async ({ page }) => {
    await goToDashboard(page);
    await expect(page.locator(`h3:has-text("${displayName}")`)).toBeVisible({ timeout: 15_000 });
  });

  test('shows running status badge', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
  });

  test('shows action buttons', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    await expect(card.locator('button:has-text("Stop")')).toBeVisible();
    await expect(card.locator('button:has-text("Archive")')).toBeVisible();
    await expect(card.locator('button:has-text("Remove")')).toBeVisible();
  });

  test('shows image ID', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    const imageId = card.locator('.font-mono');
    await expect(imageId).toBeVisible({ timeout: 30_000 });
    const text = await imageId.textContent();
    expect(text!.trim().length).toBeGreaterThan(0);
  });

  test('Restart button not visible when running', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    await expect(card.locator('button:has-text("Restart")')).toBeHidden();
  });

  test('shows icon buttons when running', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    // Should have icon buttons (Terminal, Desktop, Editor, Apps + Upload, Download)
    // These are UButton components wrapping SVGs — count all buttons that are NOT text-only action buttons
    // The card should have at least 9 buttons total (6 icon + Stop + Archive + Remove)
    const allButtons = card.locator('button');
    await expect(allButtons.first()).toBeVisible({ timeout: 10_000 });
    const buttonCount = await allButtons.count();
    // At least 6 icon buttons + 3 action buttons = 9
    expect(buttonCount).toBeGreaterThanOrEqual(9);
  });

  test('opens detail modal on name click', async ({ page }) => {
    await goToDashboard(page);
    await page.waitForSelector(`h3:has-text("${displayName}")`, { timeout: 15_000 });
    await page.locator(`h3:has-text("${displayName}")`).first().click();
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5_000 });
    // Close it
    await page.keyboard.press('Escape');
  });

  test('can stop a running container', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    await card.locator('button:has-text("Stop")').click();
    await expect(card.locator('text=stopped')).toBeVisible({ timeout: 30_000 });
  });

  test('shows Restart button when stopped', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    // Container should still be stopped from previous test
    await expect(card.locator('button:has-text("Restart")')).toBeVisible({ timeout: 15_000 });
  });

  test('can restart a stopped container', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('button:has-text("Restart")')).toBeVisible({ timeout: 15_000 });
    await card.locator('button:has-text("Restart")').click();
    // Wait for running status
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
  });

  test('can archive a container', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    acceptNextConfirm(page);
    await card.locator('button:has-text("Archive")').click();
    await expect(page.locator(`h3:has-text("${displayName}")`)).toBeHidden({ timeout: 30_000 });
    containerId = ''; // Prevent double cleanup
  });
});
