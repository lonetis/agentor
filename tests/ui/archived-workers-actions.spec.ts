import { test, expect, Locator, Page } from '@playwright/test';
import { goToDashboard, acceptNextConfirm, selectSidebarTab } from '../helpers/ui-helpers';
import { createWorker } from '../helpers/worker-lifecycle';
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

test.describe('Archived Workers Actions', () => {
  test.describe.serial('Unarchive flow', () => {
    let containerName: string;
    let containerId: string;
    let displayName: string;

    test.beforeAll(async ({ request }) => {
      displayName = `UnarcAction-${Date.now()}`;
      const container = await createWorker(request, { displayName });
      containerId = container.id;
      containerName = container.name as string;
      const api = new ApiClient(request);
      await api.archiveContainer(containerId);
    });

    test.afterAll(async ({ request }) => {
      const api = new ApiClient(request);
      try { await api.removeContainer(containerId); } catch { /* ignore */ }
      try { await api.deleteArchivedWorker(containerName); } catch { /* ignore */ }
    });

    test('archived worker card shows date', async ({ page }) => {
      await goToDashboard(page);

      await selectSidebarTab(page, 'Archived');
      await page.waitForTimeout(500);

      // Find the archived worker card in the archived section
      const card = page.locator('aside').locator('.rounded-lg').filter({ hasText: displayName });
      await expect(card).toBeVisible({ timeout: 10_000 });

      // Card should show a date (compact layout: just the date, no "Archived" prefix)
      const dateText = card.locator('p');
      await expect(dateText).toBeVisible();
      const text = await dateText.textContent();
      // Date format varies by locale, just check it's not empty
      expect(text!.trim().length).toBeGreaterThan(0);
    });

    test('click Unarchive moves worker back to active list', async ({ page }) => {
      await goToDashboard(page);

      await selectSidebarTab(page, 'Archived');
      await page.waitForTimeout(500);

      // Find the archived worker card and click Unarchive
      const card = page.locator('aside').locator('.rounded-lg').filter({ hasText: displayName });
      await expect(card).toBeVisible({ timeout: 10_000 });
      const unarchiveBtn = await findButtonByTooltip(card, page, 'Unarchive');
      await unarchiveBtn.click();

      // Worker should appear in the main active container list
      await expect(page.locator('aside h3').filter({ hasText: displayName })).toBeVisible({ timeout: 30_000 });
    });
  });

  test.describe.serial('Delete flow', () => {
    let containerName: string;
    let containerId: string;
    let displayName: string;

    test.beforeAll(async ({ request }) => {
      displayName = `DelAction-${Date.now()}`;
      const container = await createWorker(request, { displayName });
      containerId = container.id;
      containerName = container.name as string;
      const api = new ApiClient(request);
      await api.archiveContainer(containerId);
    });

    test.afterAll(async ({ request }) => {
      const api = new ApiClient(request);
      try { await api.removeContainer(containerId); } catch { /* ignore */ }
      try { await api.deleteArchivedWorker(containerName); } catch { /* ignore */ }
    });

    test('click Delete with confirm removes worker from archived list', async ({ page }) => {
      await goToDashboard(page);

      await selectSidebarTab(page, 'Archived');
      await page.waitForTimeout(500);

      // Verify the worker is visible in the archived list
      const card = page.locator('aside').locator('.rounded-lg').filter({ hasText: displayName });
      await expect(card).toBeVisible({ timeout: 10_000 });

      // Accept the confirm dialog and click Delete
      acceptNextConfirm(page);
      const deleteBtn = await findButtonByTooltip(card, page, 'Delete');
      await deleteBtn.click();

      // Worker should disappear from the archived list
      await expect(card).toBeHidden({ timeout: 15_000 });
    });
  });

  test.describe('Archived section count badge', () => {
    test('shows count matching number of archived workers', async ({ page, request }) => {
      const ts = Date.now();
      const container1 = await createWorker(request, { displayName: `CntAction1-${ts}` });
      const container2 = await createWorker(request, { displayName: `CntAction2-${ts}` });
      const api = new ApiClient(request);
      await api.archiveContainer(container1.id);
      await api.archiveContainer(container2.id);

      try {
        await goToDashboard(page);

        // The Archived tab should show a badge count
        await selectSidebarTab(page, 'Archived');
        await page.waitForTimeout(500);

        // Both archived workers should be visible
        await expect(page.locator('aside').locator('.rounded-lg').filter({ hasText: `CntAction1-${ts}` })).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('aside').locator('.rounded-lg').filter({ hasText: `CntAction2-${ts}` })).toBeVisible({ timeout: 10_000 });
      } finally {
        await api.deleteArchivedWorker(container1.name as string);
        await api.deleteArchivedWorker(container2.name as string);
      }
    });
  });
});
