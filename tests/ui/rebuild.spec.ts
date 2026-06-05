import { test, expect } from '@playwright/test';
import { goToDashboard, acceptNextConfirm, dismissNextConfirm, findButtonByTooltip, hasButtonWithTooltip } from '../helpers/ui-helpers';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';
import { ApiClient } from '../helpers/api-client';

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
    await expect(card.locator('text=running')).toBeVisible({ timeout: 10_000 });
  });
});

test.describe.serial('Rebuild Worker UI — state transition', () => {
  let workerId: string;
  let dockerContainerId: string;
  let displayName: string;

  test.beforeAll(async ({ request }) => {
    displayName = `Rebuild-ST-${Date.now()}`;
    const container = await createWorker(request, { displayName });
    // `id` is the worker's immutable UUID identity key (stable across rebuild),
    // used here to re-find the worker after a rebuild and for archived cleanup.
    workerId = container.id;
    // `containerId` is the Docker container id — this is what changes on rebuild.
    dockerContainerId = container.containerId;
  });

  test.afterAll(async ({ request }) => {
    // Clean up whatever container exists
    if (workerId) {
      await cleanupWorker(request, workerId);
    }
    // Also check archived in case something went wrong
    const api = new ApiClient(request);
    const { body: archived } = await api.listArchived();
    for (const w of archived) {
      if (w.id === workerId) {
        try { await api.deleteArchivedWorker(w.id); } catch { /* ignore */ }
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

  test('rebuilt worker keeps its id but gets a new Docker container ID', async ({ request }) => {
    const api = new ApiClient(request);
    const { body: containers } = await api.listContainers();
    // The worker is still present under the same stable UUID id.
    const found = containers.find((c: { id: string }) => c.id === workerId);
    expect(found).toBeTruthy();
    // But the underlying Docker container was recreated.
    expect(found.containerId).not.toBe(dockerContainerId);
    // Track the new Docker container id for subsequent assertions.
    dockerContainerId = found.containerId;
  });
});
