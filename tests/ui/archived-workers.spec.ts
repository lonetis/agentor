import { test, expect, Locator, Page } from '@playwright/test';
import { goToDashboard, acceptNextConfirm } from '../helpers/ui-helpers';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';
import { ApiClient } from '../helpers/api-client';

/**
 * Find an icon-only button inside a card by hovering each button and
 * matching the tooltip text that appears.
 */
async function findButtonByTooltip(card: Locator, page: Page, tooltipText: string): Promise<Locator> {
  const buttons = card.locator('button');
  const count = await buttons.count();
  for (let i = count - 1; i >= 0; i--) {
    const btn = buttons.nth(i);
    await btn.scrollIntoViewIfNeeded();
    const box = await btn.boundingBox();
    if (!box) continue;
    await page.mouse.move(0, 0);
    await page.waitForTimeout(100);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    try {
      const tooltip = page.locator('[role="tooltip"]');
      await tooltip.waitFor({ state: 'visible', timeout: 2000 });
      const text = await tooltip.textContent();
      if (text?.trim() === tooltipText) return btn;
    } catch {
      // tooltip didn't appear, try next button
    }
  }
  throw new Error(`No button with tooltip "${tooltipText}" found in card`);
}

/**
 * Check whether a button with the given tooltip text exists in the card.
 */
async function hasButtonWithTooltip(card: Locator, page: Page, tooltipText: string): Promise<boolean> {
  try {
    await findButtonByTooltip(card, page, tooltipText);
    return true;
  } catch {
    return false;
  }
}

test.describe('Archived Workers UI', () => {
  test.describe('Archive flow via API', () => {
    test('shows Archived section when archived workers exist', async ({ page, request }) => {
      // Create and archive a worker via API
      const container = await createWorker(request);
      const api = new ApiClient(request);
      await api.archiveContainer(container.id);

      await goToDashboard(page);

      // Archived section should be visible
      await expect(page.locator('button').filter({ hasText: /ARCHIVED/i })).toBeVisible({ timeout: 10_000 });

      // Cleanup
      await api.deleteArchivedWorker(container.name);
    });

    test('Archived section is collapsible', async ({ page, request }) => {
      const container = await createWorker(request);
      const api = new ApiClient(request);
      await api.archiveContainer(container.id);

      await goToDashboard(page);
      const archivedBtn = page.locator('button').filter({ hasText: /ARCHIVED/i });
      await expect(archivedBtn).toBeVisible({ timeout: 10_000 });

      // Toggle
      await archivedBtn.click();
      await page.waitForTimeout(300);
      await archivedBtn.click();
      await page.waitForTimeout(300);

      // Cleanup
      await api.deleteArchivedWorker(container.name);
    });
  });

  test.describe('Archived worker card', () => {
    test('shows archived worker name after expanding section', async ({ page, request }) => {
      const displayName = `ArcName-${Date.now()}`;
      const container = await createWorker(request, { displayName });
      const api = new ApiClient(request);
      await api.archiveContainer(container.id);

      await goToDashboard(page);

      // The Archived section button should be visible (collapsed by default)
      const archivedBtn = page.locator('button').filter({ hasText: /Archived/i });
      await expect(archivedBtn).toBeVisible({ timeout: 15_000 });
      // Click to expand
      await archivedBtn.click();
      await page.waitForTimeout(500);
      // The worker display name should appear
      await expect(page.locator('aside').locator(`text=${displayName}`)).toBeVisible({ timeout: 15_000 });

      await api.deleteArchivedWorker(container.name);
    });

    test('archived worker has Unarchive button', async ({ page, request }) => {
      const container = await createWorker(request);
      const api = new ApiClient(request);
      await api.archiveContainer(container.id);

      await goToDashboard(page);
      const archivedBtn = page.locator('button').filter({ hasText: /Archived/i });
      await expect(archivedBtn).toBeVisible({ timeout: 10_000 });
      await archivedBtn.click();
      await page.waitForTimeout(500);

      const archivedCard = page.locator('.max-h-48 .rounded-lg').first();
      expect(await hasButtonWithTooltip(archivedCard, page, 'Unarchive')).toBe(true);

      await api.deleteArchivedWorker(container.name);
    });

    test('archived worker has Delete button', async ({ page, request }) => {
      const container = await createWorker(request);
      const api = new ApiClient(request);
      await api.archiveContainer(container.id);

      await goToDashboard(page);
      const archivedBtn = page.locator('button').filter({ hasText: /Archived/i });
      await expect(archivedBtn).toBeVisible({ timeout: 10_000 });
      await archivedBtn.click();
      await page.waitForTimeout(500);

      const archivedCard = page.locator('.max-h-48 .rounded-lg').first();
      expect(await hasButtonWithTooltip(archivedCard, page, 'Delete')).toBe(true);

      await api.deleteArchivedWorker(container.name);
    });
  });

  test.describe('Archive via UI', () => {
    let containerId: string;
    let containerName: string;

    let displayName: string;

    test.beforeEach(async ({ request }) => {
      displayName = `ArcViaUI-${Date.now()}`;
      const container = await createWorker(request, { displayName });
      containerId = container.id;
      containerName = container.name as string;
    });

    test.afterEach(async ({ request }) => {
      await cleanupWorker(request, containerId);
      const api = new ApiClient(request);
      try { await api.deleteArchivedWorker(containerName); } catch { /* ignore */ }
    });

    test('archiving removes container from active list', async ({ page }) => {
      await goToDashboard(page);
      const card = page.locator('.rounded-lg').filter({ hasText: displayName });
      await expect(card).toBeVisible({ timeout: 15_000 });

      acceptNextConfirm(page);
      const archiveBtn = await findButtonByTooltip(card, page, 'Archive');
      await archiveBtn.click();

      // Container should disappear from active list
      await expect(page.locator(`h3:has-text("${displayName}")`)).toBeHidden({ timeout: 30_000 });
      containerId = ''; // Prevent double cleanup
    });
  });
});
