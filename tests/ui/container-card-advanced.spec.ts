import { test, expect } from '@playwright/test';
import { goToDashboard, acceptNextConfirm, findButtonByTooltip, hasButtonWithTooltip } from '../helpers/ui-helpers';
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

  test('running card shows all icon buttons (Terminal, Desktop, Editor, Apps, Upload, Download, Stop, Archive, Remove)', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    // All buttons are now icon-only (view + action in a single row)
    const iconButtons = card.locator('button');
    await expect(iconButtons.first()).toBeVisible({ timeout: 10_000 });
    const count = await iconButtons.count();
    // 9 icon buttons: Terminal, Desktop, Editor, Apps, Upload, Download, Stop, Archive, Remove
    expect(count).toBeGreaterThanOrEqual(9);
  });

  test('running card shows Stop button but not Restart', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    // Action buttons are icon-only with tooltips — verify via hover
    expect(await hasButtonWithTooltip(card, page, 'Stop')).toBe(true);
    expect(await hasButtonWithTooltip(card, page, 'Restart')).toBe(false);
  });

  test('stop transitions card to stopped state', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    const stopBtn = await findButtonByTooltip(card, page, 'Stop');
    await stopBtn.click();
    await expect(card.locator('text=stopped')).toBeVisible({ timeout: 30_000 });
  });

  test('stopped card shows Restart button but not Stop', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    // Wait for the card to settle in stopped state
    await expect(card.locator('text=stopped')).toBeVisible({ timeout: 15_000 });
    expect(await hasButtonWithTooltip(card, page, 'Restart')).toBe(true);
    expect(await hasButtonWithTooltip(card, page, 'Stop')).toBe(false);
  });

  test('stopped card hides view buttons but keeps action buttons', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.locator('text=stopped')).toBeVisible({ timeout: 15_000 });
    // When stopped, view buttons (Terminal, Desktop, etc.) are hidden (v-if="isRunning")
    // but action buttons (Restart, Archive, Remove) remain as icon buttons
    const iconButtons = card.locator('button');
    const count = await iconButtons.count();
    // 4 action buttons remain: Restart, Rebuild, Archive, Remove
    expect(count).toBe(4);
  });

  test('restart transitions card back to running state', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=stopped')).toBeVisible({ timeout: 15_000 });
    const restartBtn = await findButtonByTooltip(card, page, 'Restart');
    await restartBtn.click();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
  });

  test('archive removes card from active list', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    acceptNextConfirm(page);
    const archiveBtn = await findButtonByTooltip(card, page, 'Archive');
    await archiveBtn.click();
    await expect(page.locator(`h3:has-text("${displayName}")`)).toBeHidden({ timeout: 30_000 });
    containerId = ''; // Prevent double cleanup
  });
});
