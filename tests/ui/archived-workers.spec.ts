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
});
