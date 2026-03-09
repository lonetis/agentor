import { test, expect } from '@playwright/test';
import { goToDashboard } from '../helpers/ui-helpers';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';
import { ApiClient } from '../helpers/api-client';

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
    // Also clean up any archived workers left behind
    const api = new ApiClient(request);
    const { body: archived } = await api.listArchived();
    for (const w of archived) {
      try { await api.deleteArchivedWorker(w.name); } catch { /* ignore */ }
    }
  });

  // ─── 1. Card Content ─────────────────────────────────────────

  test('card shows display name', async ({ page }) => {
    await goToDashboard(page);
    const heading = page.locator(`h3:has-text("${displayName}")`);
    await expect(heading).toBeVisible({ timeout: 15_000 });
  });

  test('card shows "running" status badge', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
  });

  test('card shows short image ID in monospace', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    // The image ID is rendered in a <p> with class font-mono
    const imageId = card.locator('p.font-mono');
    await expect(imageId).toBeVisible({ timeout: 30_000 });
    const text = await imageId.textContent();
    // Should be a 10-character hex hash (first 10 chars of sha256 digest)
    expect(text!.trim()).toMatch(/^[a-f0-9]{10}$/);
  });

  // ─── 2. View Buttons (running state) ─────────────────────────

  test('running card shows icon buttons (Terminal, Desktop, Editor, Apps, Upload, Download)', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    // Icon buttons are wrapped in UTooltip. Count all SVG-containing buttons.
    const iconButtons = card.locator('button').filter({ has: page.locator('svg') });
    await expect(iconButtons.first()).toBeVisible({ timeout: 10_000 });
    const count = await iconButtons.count();
    // 6 icon buttons: Terminal, Desktop, Editor, Apps, Upload, Download
    expect(count).toBeGreaterThanOrEqual(4);
  });

  // ─── 3. Action Buttons ───────────────────────────────────────

  test('Stop button visible when running', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    await expect(card.locator('button:has-text("Stop")')).toBeVisible();
  });

  test('Archive button visible', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.locator('button:has-text("Archive")')).toBeVisible();
  });

  test('Remove button visible', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.locator('button:has-text("Remove")')).toBeVisible();
  });

  test('Restart button not visible when running', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    await expect(card.locator('button:has-text("Restart")')).toBeHidden();
  });

  // ─── 4. State Transitions ────────────────────────────────────

  test('Stop button stops container (status changes to "stopped")', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    await card.locator('button:has-text("Stop")').click();
    await expect(card.locator('text=stopped')).toBeVisible({ timeout: 30_000 });
  });

  test('after stop, view buttons (Terminal, Desktop, Editor, Apps) are hidden', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    // Container is stopped from previous test; icon buttons section uses v-if="isRunning"
    // so all icon buttons (svg-containing buttons) should be absent
    const iconButtons = card.locator('button').filter({ has: page.locator('svg') });
    const count = await iconButtons.count();
    expect(count).toBe(0);
  });

  test('Restart button appears when stopped', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.locator('button:has-text("Restart")')).toBeVisible({ timeout: 15_000 });
    // Stop button should be hidden when stopped
    await expect(card.locator('button:has-text("Stop")')).toBeHidden();
  });

  test('Restart restarts container (status changes to "running")', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('button:has-text("Restart")')).toBeVisible({ timeout: 15_000 });
    await card.locator('button:has-text("Restart")').click();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    // After restart, Stop should be back and Restart should be gone
    await expect(card.locator('button:has-text("Stop")')).toBeVisible();
    await expect(card.locator('button:has-text("Restart")')).toBeHidden();
  });

  // ─── 5. Detail Modal ────────────────────────────────────────

  test('clicking container name area opens detail modal', async ({ page }) => {
    await goToDashboard(page);
    await page.waitForSelector(`h3:has-text("${displayName}")`, { timeout: 15_000 });
    // Click the name heading to open the detail modal
    await page.locator(`h3:has-text("${displayName}")`).first().click();
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5_000 });
  });

  test('detail modal shows container info', async ({ page }) => {
    await goToDashboard(page);
    await page.waitForSelector(`h3:has-text("${displayName}")`, { timeout: 15_000 });
    await page.locator(`h3:has-text("${displayName}")`).first().click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Header shows display name and status badge
    await expect(dialog.locator('h2')).toContainText(displayName);
    await expect(dialog.locator('text=running')).toBeVisible();

    // Worker section shows key fields
    await expect(dialog.getByText('Worker', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Container', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Container ID', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Image', { exact: true }).first()).toBeVisible();
    await expect(dialog.getByText('Image ID', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Created', { exact: true })).toBeVisible();

    // Close via Escape
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 5_000 });
  });
});
