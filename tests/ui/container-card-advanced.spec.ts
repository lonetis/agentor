import { test, expect } from '@playwright/test';
import { goToDashboard, acceptNextConfirm } from '../helpers/ui-helpers';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';
import { ApiClient } from '../helpers/api-client';

test.describe.serial('Container Card — Advanced', () => {
  let containerId: string;
  let displayName: string;

  test.beforeAll(async ({ request }) => {
    displayName = `CardAdv-${Date.now()}`;
    const container = await createWorker(request, { displayName });
    containerId = container.id;
  });

  test.afterAll(async ({ request }) => {
    if (containerId) {
      await cleanupWorker(request, containerId);
    }
    const api = new ApiClient(request);
    const { body: archived } = await api.listArchived();
    for (const w of archived) {
      try { await api.deleteArchivedWorker(w.name); } catch { /* ignore */ }
    }
  });

  test('running card shows all icon buttons (Terminal, Desktop, Editor, Apps, Upload, Download)', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    // Icon buttons are the ones with SVGs (not text action buttons)
    const iconButtons = card.locator('button').filter({ has: page.locator('svg') });
    await expect(iconButtons.first()).toBeVisible({ timeout: 10_000 });
    const count = await iconButtons.count();
    // 6 icon buttons: Terminal, Desktop, Editor, Apps, Upload, Download
    expect(count).toBeGreaterThanOrEqual(6);
  });

  test('running card shows Stop button but not Restart', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    await expect(card.locator('button:has-text("Stop")')).toBeVisible();
    await expect(card.locator('button:has-text("Restart")')).toBeHidden();
  });

  test('stop transitions card to stopped state', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    await card.locator('button:has-text("Stop")').click();
    await expect(card.locator('text=stopped')).toBeVisible({ timeout: 30_000 });
  });

  test('stopped card shows Restart button but not Stop', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.locator('button:has-text("Restart")')).toBeVisible({ timeout: 15_000 });
    await expect(card.locator('button:has-text("Stop")')).toBeHidden();
  });

  test('stopped card hides icon buttons (Terminal, Desktop, etc.)', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    // When stopped, icon buttons section should be hidden (v-if="isRunning")
    const iconButtons = card.locator('button').filter({ has: page.locator('svg') });
    const count = await iconButtons.count();
    // No icon buttons when stopped (only text action buttons remain)
    expect(count).toBe(0);
  });

  test('restart transitions card back to running state', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('button:has-text("Restart")')).toBeVisible({ timeout: 15_000 });
    await card.locator('button:has-text("Restart")').click();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
  });

  test('archive removes card from active list', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    acceptNextConfirm(page);
    await card.locator('button:has-text("Archive")').click();
    await expect(page.locator(`h3:has-text("${displayName}")`)).toBeHidden({ timeout: 30_000 });
    containerId = ''; // Prevent double cleanup
  });
});
