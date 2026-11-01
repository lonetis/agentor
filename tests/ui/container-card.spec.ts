import { test, expect } from '@playwright/test';
import { goToDashboard, acceptNextConfirm, findButtonByTooltip, hasButtonWithTooltip, selectSidebarTab } from '../helpers/ui-helpers';
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
      try { await api.deleteArchivedWorker(w.id); } catch { /* ignore */ }
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

  test('a long display name is truncated and keeps the status badge inside the card', async ({ page, request }) => {
    const api = new ApiClient(request);
    // Keep the current name as a prefix so every other locator still matches
    // the card even if renaming back were to fail.
    const longName = `${displayName}-${'x'.repeat(90 - displayName.length - 1)}`;
    expect((await api.renameContainer(containerId, longName)).status).toBe(200);
    try {
      await goToDashboard(page);
      const card = page.locator('.rounded-lg').filter({ hasText: longName }).first();
      const badge = card.locator('text=running');
      await expect(badge).toBeVisible({ timeout: 60_000 });
      const heading = card.locator('h3');
      await expect(heading).toHaveText(longName);
      // The name is clipped instead of pushing the badge out of the card.
      expect(await heading.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
      const cardBox = (await card.boundingBox())!;
      const badgeBox = (await badge.boundingBox())!;
      expect(badgeBox.x).toBeGreaterThanOrEqual(cardBox.x);
      expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
    } finally {
      expect((await api.renameContainer(containerId, displayName)).status).toBe(200);
    }
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

  test('icon buttons expose their tooltip text as the accessible name', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    for (const name of ['Terminal', 'Editor', 'Desktop', 'Apps', 'Upload to Workspace', 'Download Workspace', 'Export worker', 'Settings', 'Stop', 'Rebuild', 'Archive', 'Remove']) {
      await expect(card.getByRole('button', { name, exact: true })).toBeVisible();
    }
    // Button order is part of the contract (index-based clicks elsewhere).
    await expect(card.locator('button').first()).toHaveAttribute('aria-label', 'Terminal');
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
    // Stopping moves the worker out of the Workers tab into the Stopped tab.
    await selectSidebarTab(page, 'Stopped');
    const stoppedCard = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(stoppedCard.getByText('stopped', { exact: true })).toBeVisible({ timeout: 30_000 });
  });

  test('after stop, view buttons (Terminal, Desktop, Editor, Apps) are hidden', async ({ page }) => {
    await goToDashboard(page);
    // The worker is stopped from the previous test → it lives in the Stopped tab.
    await selectSidebarTab(page, 'Stopped');
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByText('stopped', { exact: true })).toBeVisible({ timeout: 15_000 });
    // Container is stopped from previous test; view + workspace buttons (Terminal,
    // Desktop, Upload, etc.) are hidden (v-if="isRunning") but action buttons remain
    const iconButtons = card.locator('button');
    const count = await iconButtons.count();
    // 5 buttons remain: Settings, Restart, Rebuild, Archive, Remove. View +
    // workspace buttons (incl. Export, grouped with the workspace actions) are
    // running-only (v-if="isRunning"), per FEATURES §4.2.
    expect(count).toBe(5);
  });

  test('Restart button appears when stopped', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'Stopped');
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByText('stopped', { exact: true })).toBeVisible({ timeout: 15_000 });
    expect(await hasButtonWithTooltip(card, page, 'Restart')).toBe(true);
    // Stop button should be hidden when stopped
    expect(await hasButtonWithTooltip(card, page, 'Stop')).toBe(false);
  });

  test('Restart restarts container (status changes to "running")', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'Stopped');
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.getByText('stopped', { exact: true })).toBeVisible({ timeout: 15_000 });
    const restartBtn = await findButtonByTooltip(card, page, 'Restart');
    await restartBtn.click();
    // Restarting moves the worker back to the Workers tab.
    await selectSidebarTab(page, 'Workers');
    const runningCard = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(runningCard.locator('text=running')).toBeVisible({ timeout: 60_000 });
    // After restart, Stop should be back and Restart should be gone
    expect(await hasButtonWithTooltip(runningCard, page, 'Stop')).toBe(true);
    expect(await hasButtonWithTooltip(runningCard, page, 'Restart')).toBe(false);
  });

  // ─── 5. Detail Modal ────────────────────────────────────────

  test('clicking container name area opens detail modal', async ({ page }) => {
    await goToDashboard(page);
    await page.waitForSelector(`h3:has-text("${displayName}")`, { timeout: 15_000 });
    // Click the name heading to open the detail modal
    await page.locator(`h3:has-text("${displayName}")`).first().click();
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 10_000 });
  });

  test('detail modal shows container info', async ({ page }) => {
    await goToDashboard(page);
    await page.waitForSelector(`h3:has-text("${displayName}")`, { timeout: 15_000 });
    await page.locator(`h3:has-text("${displayName}")`).first().click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // Header shows display name and status badge
    await expect(dialog.locator('h2')).toContainText(displayName);
    await expect(dialog.locator('text=running')).toBeVisible();

    // Worker section shows key fields
    await expect(dialog.getByText('Worker', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Worker ID', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Container ID', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Image', { exact: true }).first()).toBeVisible();
    await expect(dialog.getByText('Image ID', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Created', { exact: true })).toBeVisible();

    // Close via Escape
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 10_000 });
  });

  // ─── 6. Archive Action ──────────────────────────────────────

  test.describe('Archive action', () => {
    test('archive button removes card from active list', async ({ request, page }) => {
      // This test consumes the worker; create a dedicated one so it doesn't
      // interfere with the serial flow above.
      const archiveDisplayName = `CardArchive-${Date.now()}`;
      const archiveContainer = await createWorker(request, { displayName: archiveDisplayName });
      let cleanupId: string | undefined = archiveContainer.id;
      try {
        await goToDashboard(page);
        const card = page.locator('.rounded-lg').filter({ hasText: archiveDisplayName }).first();
        await expect(card).toBeVisible({ timeout: 15_000 });
        acceptNextConfirm(page);
        const archiveBtn = await findButtonByTooltip(card, page, 'Archive');
        await archiveBtn.click();
        await expect(page.locator(`h3:has-text("${archiveDisplayName}")`)).toBeHidden({ timeout: 30_000 });
        cleanupId = undefined; // Archived — no active container to remove
      } finally {
        if (cleanupId) {
          await cleanupWorker(request, cleanupId);
        }
      }
    });
  });
});

// ─── 7. Rename (via Settings modal) ────────────────────────────
// The Settings pencil opens the Worker Settings modal where the display name is
// an editable field applied without a rebuild. Exercised on a dedicated worker so it never
// interferes with the serial flow above.

test.describe.serial('Container Card — Settings pencil opens the settings modal', () => {
  let containerId: string;
  let displayName: string;

  test.beforeAll(async ({ request }) => {
    displayName = `CardRename-${Date.now()}`;
    const container = await createWorker(request, { displayName });
    containerId = container.id;
  });

  test.afterAll(async ({ request }) => {
    if (containerId) {
      await cleanupWorker(request, containerId);
    }
  });

  test('Settings pencil opens the modal and renames via the display-name field', async ({ page }) => {
    const newDisplayName = `CardRenamed-${Date.now()}`;

    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });

    // Click the Settings (i-lucide-pencil) button — it opens the settings modal.
    const settingsBtn = await findButtonByTooltip(card, page, 'Settings');
    await settingsBtn.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // Edit the display-name field and Save (no rebuild for a name change).
    const nameInput = dialog.getByPlaceholder('Worker label');
    await expect(nameInput).toHaveValue(displayName);
    await nameInput.fill(newDisplayName);
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // The card title updates to the new label and the old one is gone.
    await expect(page.locator(`h3:has-text("${newDisplayName}")`).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(`h3:has-text("${displayName}")`)).toHaveCount(0);

    displayName = newDisplayName;
  });
});
