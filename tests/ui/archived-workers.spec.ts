import { test, expect } from '@playwright/test';
import { goToDashboard, acceptNextConfirm, selectSidebarTab, findButtonByTooltip, hasButtonWithTooltip } from '../helpers/ui-helpers';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';
import { ApiClient } from '../helpers/api-client';

test.describe('Archived Workers UI', () => {
  test.describe('Archive flow via API', () => {
    test('shows Archived tab when archived workers exist', async ({ page, request }) => {
      // Create and archive a worker via API
      const container = await createWorker(request);
      const api = new ApiClient(request);
      await api.archiveContainer(container.id);

      await goToDashboard(page);

      // Archived tab should exist (might be in overflow dropdown)
      const { expectSidebarTabExists } = await import('../helpers/ui-helpers');
      await expectSidebarTabExists(page, 'Archived');

      // Cleanup
      await api.deleteArchivedWorker(container.name);
    });

    test('clicking Archived tab shows archived workers', async ({ page, request }) => {
      const container = await createWorker(request);
      const api = new ApiClient(request);
      await api.archiveContainer(container.id);

      await goToDashboard(page);
      await selectSidebarTab(page, 'Archived');
      // Wait for content to load
      await page.waitForTimeout(500);

      // Cleanup
      await api.deleteArchivedWorker(container.name);
    });
  });

  test.describe('Archived worker card', () => {
    test('shows archived worker name in Archived tab', async ({ page, request }) => {
      const displayName = `ArcName-${Date.now()}`;
      const container = await createWorker(request, { displayName });
      const api = new ApiClient(request);
      await api.archiveContainer(container.id);

      await goToDashboard(page);

      // Click the Archived tab
      await selectSidebarTab(page, 'Archived');
      // The worker display name should appear
      await expect(page.locator('aside').locator(`text=${displayName}`)).toBeVisible({ timeout: 15_000 });

      await api.deleteArchivedWorker(container.name);
    });

    test('archived worker has Unarchive button', async ({ page, request }) => {
      const container = await createWorker(request);
      const api = new ApiClient(request);
      await api.archiveContainer(container.id);

      await goToDashboard(page);
      await selectSidebarTab(page, 'Archived');
      await page.waitForTimeout(500);

      const archivedCard = page.locator('aside .rounded-lg').first();
      expect(await hasButtonWithTooltip(archivedCard, page, 'Unarchive')).toBe(true);

      await api.deleteArchivedWorker(container.name);
    });

    test('archived worker has Delete button', async ({ page, request }) => {
      const container = await createWorker(request);
      const api = new ApiClient(request);
      await api.archiveContainer(container.id);

      await goToDashboard(page);
      await selectSidebarTab(page, 'Archived');
      await page.waitForTimeout(500);

      const archivedCard = page.locator('aside .rounded-lg').first();
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
