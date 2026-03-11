import { test, expect, Locator, Page } from '@playwright/test';
import { goToDashboard, acceptNextConfirm, dismissNextConfirm } from '../helpers/ui-helpers';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';
import { ApiClient } from '../helpers/api-client';

/**
 * Find an icon-only button inside a container card by hovering each button and
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

async function hasButtonWithTooltip(card: Locator, page: Page, tooltipText: string): Promise<boolean> {
  try {
    await findButtonByTooltip(card, page, tooltipText);
    return true;
  } catch {
    return false;
  }
}

test.describe('Rebuild Worker UI', () => {
  let containerId: string;
  let displayName: string;

  test.beforeAll(async ({ request }) => {
    displayName = `Rebuild-UI-${Date.now()}`;
    const container = await createWorker(request, { displayName });
    containerId = container.id;
  });

  test.afterAll(async ({ request }) => {
    if (containerId) {
      await cleanupWorker(request, containerId);
    }
  });

  test('Rebuild button is visible on container card', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    expect(await hasButtonWithTooltip(card, page, 'Rebuild')).toBe(true);
  });

  test('Rebuild button is visible when container is stopped', async ({ request, page }) => {
    const api = new ApiClient(request);
    await api.stopContainer(containerId);
    await new Promise(r => setTimeout(r, 1000));

    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=stopped')).toBeVisible({ timeout: 15_000 });
    expect(await hasButtonWithTooltip(card, page, 'Rebuild')).toBe(true);

    // Restart for subsequent tests
    await api.restartContainer(containerId);
  });

  test('dismiss confirm dialog cancels rebuild', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

    dismissNextConfirm(page);
    const rebuildBtn = await findButtonByTooltip(card, page, 'Rebuild');
    await rebuildBtn.click();

    // Container should still be there with the same name
    await expect(card.locator('text=running')).toBeVisible({ timeout: 5_000 });
  });
});

test.describe.serial('Rebuild Worker UI — state transition', () => {
  let containerId: string;
  let containerName: string;
  let displayName: string;

  test.beforeAll(async ({ request }) => {
    displayName = `Rebuild-ST-${Date.now()}`;
    const container = await createWorker(request, { displayName });
    containerId = container.id;
    containerName = container.name;
  });

  test.afterAll(async ({ request }) => {
    // Clean up whatever container exists
    if (containerId) {
      await cleanupWorker(request, containerId);
    }
    // Also check archived in case something went wrong
    const api = new ApiClient(request);
    const { body: archived } = await api.listArchived();
    for (const w of archived) {
      if (w.name === containerName) {
        try { await api.deleteArchivedWorker(w.name); } catch { /* ignore */ }
      }
    }
  });

  test('clicking Rebuild with confirm rebuilds the container', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

    acceptNextConfirm(page);
    const rebuildBtn = await findButtonByTooltip(card, page, 'Rebuild');
    await rebuildBtn.click();

    // Container should eventually appear as running again (new container, same name)
    const rebuiltCard = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(rebuiltCard.locator('text=running')).toBeVisible({ timeout: 90_000 });
  });

  test('rebuilt container has the same display name', async ({ page }) => {
    await goToDashboard(page);
    const heading = page.locator(`h3:has-text("${displayName}")`);
    await expect(heading).toBeVisible({ timeout: 15_000 });
  });

  test('rebuilt container has new container ID', async ({ request }) => {
    const api = new ApiClient(request);
    const { body: containers } = await api.listContainers();
    const found = containers.find((c: { name: string }) => c.name === containerName);
    expect(found).toBeTruthy();
    // The container ID should have changed
    expect(found.id).not.toBe(containerId);
    // Update for cleanup
    containerId = found.id;
  });
});
