import { test, expect } from '@playwright/test';
import { goToDashboard, findButtonByTooltip, hasButtonWithTooltip } from '../helpers/ui-helpers';
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
    // The image ID is rendered in a <span> with class font-mono
    const imageId = card.locator('span.font-mono');
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
    // All buttons (view + action) are icon-only UButtons
    const iconButtons = card.locator('button');
    await expect(iconButtons.first()).toBeVisible({ timeout: 10_000 });
    const count = await iconButtons.count();
    // 9 buttons: Terminal, Desktop, Editor, Apps, Upload, Download + Stop, Archive, Remove
    expect(count).toBeGreaterThanOrEqual(9);
  });

  // ─── 3. Action Buttons ───────────────────────────────────────

  test('Stop button visible when running', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    expect(await hasButtonWithTooltip(card, page, 'Stop')).toBe(true);
  });

  test('Archive button visible', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    expect(await hasButtonWithTooltip(card, page, 'Archive')).toBe(true);
  });

  test('Remove button visible', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    expect(await hasButtonWithTooltip(card, page, 'Remove')).toBe(true);
  });

  test('Restart button not visible when running', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    expect(await hasButtonWithTooltip(card, page, 'Restart')).toBe(false);
  });

  // ─── 4. State Transitions ────────────────────────────────────

  test('Stop button stops container (status changes to "stopped")', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    const stopBtn = await findButtonByTooltip(card, page, 'Stop');
    await stopBtn.click();
    await expect(card.locator('text=stopped')).toBeVisible({ timeout: 30_000 });
  });

  test('after stop, view buttons (Terminal, Desktop, Editor, Apps) are hidden', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.locator('text=stopped')).toBeVisible({ timeout: 15_000 });
    // Container is stopped from previous test; view buttons (Terminal, Desktop, etc.)
    // are hidden (v-if="isRunning") but action buttons (Restart, Archive, Remove) remain
    const iconButtons = card.locator('button');
    const count = await iconButtons.count();
    // 4 action buttons remain: Restart, Rebuild, Archive, Remove
    expect(count).toBe(4);
  });

  test('Restart button appears when stopped', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.locator('text=stopped')).toBeVisible({ timeout: 15_000 });
    expect(await hasButtonWithTooltip(card, page, 'Restart')).toBe(true);
    // Stop button should be hidden when stopped
    expect(await hasButtonWithTooltip(card, page, 'Stop')).toBe(false);
  });

  test('Restart restarts container (status changes to "running")', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=stopped')).toBeVisible({ timeout: 15_000 });
    const restartBtn = await findButtonByTooltip(card, page, 'Restart');
    await restartBtn.click();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    // After restart, Stop should be back and Restart should be gone
    expect(await hasButtonWithTooltip(card, page, 'Stop')).toBe(true);
    expect(await hasButtonWithTooltip(card, page, 'Restart')).toBe(false);
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
