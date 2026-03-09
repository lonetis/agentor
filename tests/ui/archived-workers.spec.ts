import { test, expect } from '@playwright/test';
import { goToDashboard, acceptNextConfirm } from '../helpers/ui-helpers';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';
import { ApiClient } from '../helpers/api-client';

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

      await expect(page.locator('aside').locator('button:has-text("Unarchive")').first()).toBeVisible({ timeout: 10_000 });

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

      await expect(page.locator('aside').locator('button:has-text("Delete")').first()).toBeVisible({ timeout: 10_000 });

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
      await card.locator('button:has-text("Archive")').click();

      // Container should disappear from active list
      await expect(page.locator(`h3:has-text("${displayName}")`)).toBeHidden({ timeout: 30_000 });
      containerId = ''; // Prevent double cleanup
    });
  });
});
