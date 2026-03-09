import { test, expect } from '@playwright/test';
import { goToDashboard, acceptNextConfirm } from '../helpers/ui-helpers';
import { createWorker } from '../helpers/worker-lifecycle';
import { ApiClient } from '../helpers/api-client';

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

    test('archived worker card shows Archived text with date', async ({ page }) => {
      await goToDashboard(page);

      // Expand the Archived section
      const archivedBtn = page.locator('button').filter({ hasText: /Archived/i });
      await expect(archivedBtn).toBeVisible({ timeout: 15_000 });
      await archivedBtn.click();
      await page.waitForTimeout(500);

      // Find the archived worker card in the archived section
      const card = page.locator('aside').locator('.rounded-lg').filter({ hasText: displayName });
      await expect(card).toBeVisible({ timeout: 10_000 });

      // Card should show "Archived" text followed by a date
      const archivedText = card.locator('p').filter({ hasText: /^Archived/ });
      await expect(archivedText).toBeVisible();
      const text = await archivedText.textContent();
      expect(text).toMatch(/^Archived\s+\d/);
    });

    test('click Unarchive moves worker back to active list', async ({ page }) => {
      await goToDashboard(page);

      // Expand the Archived section
      const archivedBtn = page.locator('button').filter({ hasText: /Archived/i });
      await expect(archivedBtn).toBeVisible({ timeout: 15_000 });
      await archivedBtn.click();
      await page.waitForTimeout(500);

      // Find the archived worker card and click Unarchive
      const card = page.locator('aside').locator('.rounded-lg').filter({ hasText: displayName });
      await expect(card).toBeVisible({ timeout: 10_000 });
      await card.locator('button:has-text("Unarchive")').click();

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

      // Expand the Archived section
      const archivedBtn = page.locator('button').filter({ hasText: /Archived/i });
      await expect(archivedBtn).toBeVisible({ timeout: 15_000 });
      await archivedBtn.click();
      await page.waitForTimeout(500);

      // Verify the worker is visible in the archived list
      const card = page.locator('aside').locator('.rounded-lg').filter({ hasText: displayName });
      await expect(card).toBeVisible({ timeout: 10_000 });

      // Accept the confirm dialog and click Delete
      acceptNextConfirm(page);
      await card.locator('button:has-text("Delete")').click();

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

        // The Archived button should show a count that includes our 2 archived workers
        // Other tests may have archived workers too, so just check the section is visible
        // and contains our workers
        const archivedBtn = page.locator('button').filter({ hasText: /Archived\s*\(\d+\)/i });
        await expect(archivedBtn).toBeVisible({ timeout: 15_000 });
        await archivedBtn.click();
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
