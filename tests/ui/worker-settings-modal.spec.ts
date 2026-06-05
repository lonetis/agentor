import { test, expect } from '@playwright/test';
import { goToDashboard } from '../helpers/ui-helpers';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';

// Behavioural coverage for the editable Worker Settings modal: display-name
// edits apply without a rebuild, while rebuild-requiring edits (init script,
// environment, repos, mounts) flag the worker "rebuild pending" and surface a
// "Save & Rebuild" action.

async function openSettings(page: import('@playwright/test').Page, displayName: string) {
  await goToDashboard(page);
  await page.waitForSelector(`h3:has-text("${displayName}")`, { timeout: 15_000 });
  await page.locator(`h3:has-text("${displayName}")`).first().click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  return dialog;
}

test.describe.serial('Worker Settings Modal — display-name edit applies without rebuild', () => {
  let containerId: string;
  let displayName: string;

  test.beforeAll(async ({ request }) => {
    displayName = `WSLive-${Date.now()}`;
    const c = await createWorker(request, { displayName });
    containerId = c.id;
  });
  test.afterAll(async ({ request }) => {
    if (containerId) await cleanupWorker(request, containerId);
  });

  test('changing only the display name does not require a rebuild', async ({ page }) => {
    const dialog = await openSettings(page, displayName);
    const newName = `WSLiveRenamed-${Date.now()}`;

    const nameInput = dialog.getByPlaceholder('Worker label');
    await nameInput.fill(newName);

    // A pure display-name change must NOT offer "Save & Rebuild".
    await expect(dialog.getByRole('button', { name: 'Save & Rebuild' })).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // Card updates and shows NO "rebuild pending" badge.
    const card = page.locator('.rounded-lg').filter({ hasText: newName }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.locator('text=rebuild pending')).toHaveCount(0);

    // Persists across reload.
    await goToDashboard(page);
    await expect(page.locator(`h3:has-text("${newName}")`).first()).toBeVisible({ timeout: 15_000 });
    displayName = newName;
  });
});

test.describe.serial('Worker Settings Modal — rebuild-requiring edit flags pending', () => {
  let containerId: string;
  let displayName: string;

  test.beforeAll(async ({ request }) => {
    displayName = `WSPending-${Date.now()}`;
    const c = await createWorker(request, { displayName });
    containerId = c.id;
  });
  test.afterAll(async ({ request }) => {
    if (containerId) await cleanupWorker(request, containerId);
  });

  test('editing the init script reveals Save & Rebuild and flags pending on Save', async ({ page }) => {
    const dialog = await openSettings(page, displayName);

    // No rebuild action until a rebuild-requiring field changes.
    await expect(dialog.getByRole('button', { name: 'Save & Rebuild' })).toHaveCount(0);

    const textarea = dialog.locator('textarea').first();
    await textarea.fill(`echo ws-pending-${Date.now()}`);

    // Now a rebuild is required.
    await expect(dialog.getByRole('button', { name: 'Save & Rebuild' })).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText('Changes require a rebuild to take effect.')).toBeVisible();

    // "Save" (without rebuild) persists and flags pending.
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=rebuild pending')).toBeVisible({ timeout: 15_000 });

    // Re-opening shows the pending banner with a "Rebuild now" action.
    await page.locator(`h3:has-text("${displayName}")`).first().click();
    const dialog2 = page.locator('[role="dialog"]');
    await expect(dialog2).toBeVisible({ timeout: 10_000 });
    await expect(dialog2.getByText('Rebuild pending', { exact: true })).toBeVisible();
    await expect(dialog2.getByRole('button', { name: 'Rebuild now' })).toBeVisible();
  });

  test('Save & Rebuild applies the change and clears the pending state', async ({ page }) => {
    test.setTimeout(180_000);
    const dialog = await openSettings(page, displayName);

    const textarea = dialog.locator('textarea').first();
    await textarea.fill(`echo ws-applied-${Date.now()}`);

    await dialog.getByRole('button', { name: 'Save & Rebuild' }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // After the rebuild completes the card is running again with no pending flag.
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 120_000 });
    await expect(card.locator('text=rebuild pending')).toHaveCount(0, { timeout: 15_000 });
  });
});
