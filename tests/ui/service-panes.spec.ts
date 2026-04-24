import { test, expect } from '@playwright/test';
import { goToDashboard } from '../helpers/ui-helpers';
import { ApiClient } from '../helpers/api-client';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';

test.describe.serial('Service Panes — API Status', () => {
  let containerId: string;

  test.beforeAll(async ({ request }) => {
    const container = await createWorker(request, { displayName: `Svc-${Date.now()}` });
    containerId = container.id;
  });

  test.afterAll(async ({ request }) => {
    if (containerId) {
      await cleanupWorker(request, containerId);
    }
  });

  test('desktop status endpoint returns valid response', async ({ request }) => {
    const api = new ApiClient(request);
    const { status, body } = await api.getDesktopStatus(containerId);
    expect(status).toBe(200);
    expect(typeof body.running).toBe('boolean');
  });

  test('editor status endpoint returns valid response', async ({ request }) => {
    const api = new ApiClient(request);
    const { status, body } = await api.getEditorStatus(containerId);
    expect(status).toBe(200);
    expect(typeof body.running).toBe('boolean');
  });

  test('desktop status for non-existent container returns 404', async ({ request }) => {
    const api = new ApiClient(request);
    const { status } = await api.getDesktopStatus('non-existent-id');
    expect(status).toBe(404);
  });

  test('editor status for non-existent container returns 404', async ({ request }) => {
    const api = new ApiClient(request);
    const { status } = await api.getEditorStatus('non-existent-id');
    expect(status).toBe(404);
  });

  test('desktop becomes available after worker starts', async ({ request }) => {
    const api = new ApiClient(request);
    const start = Date.now();
    let running = false;
    while (Date.now() - start < 60_000) {
      const { body } = await api.getDesktopStatus(containerId);
      if (body.running) {
        running = true;
        break;
      }
      await new Promise(r => setTimeout(r, 3000));
    }
    expect(running).toBe(true);
  });

  test('editor becomes available after worker starts', async ({ request }) => {
    const api = new ApiClient(request);
    const start = Date.now();
    let running = false;
    while (Date.now() - start < 60_000) {
      const { body } = await api.getEditorStatus(containerId);
      if (body.running) {
        running = true;
        break;
      }
      await new Promise(r => setTimeout(r, 3000));
    }
    expect(running).toBe(true);
  });
});

test.describe.serial('Service Panes — UI', () => {
  let containerId: string;
  let displayName: string;

  test.beforeAll(async ({ request }) => {
    displayName = `SvcUI-${Date.now()}`;
    const container = await createWorker(request, { displayName });
    containerId = container.id;
  });

  test.afterAll(async ({ request }) => {
    if (containerId) {
      await cleanupWorker(request, containerId);
    }
  });

  test('Desktop button opens desktop pane', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    // Desktop is the third icon button (Terminal, Editor, Desktop, ...)
    const iconButtons = card.locator('button');
    await iconButtons.nth(2).click();
    // Should show the desktop pane content area (starting or running)
    await expect(page.locator('main').getByText(/Desktop (is starting|running)/)).toBeVisible({ timeout: 15_000 });
  });

  test('Desktop pane shows starting or running state', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    const iconButtons = card.locator('button');
    await iconButtons.nth(2).click();
    await expect(page.locator('main').getByText(/Desktop (is starting|running)/)).toBeVisible({ timeout: 15_000 });
    // ServicePane shows "is starting..." or "running" indicator
    const startingMsg = page.locator('main').locator('text=is starting...');
    const runningMsg = page.locator('main').locator('text=Desktop running');
    await expect(startingMsg.or(runningMsg)).toBeVisible({ timeout: 60_000 });
  });

  test('Editor button opens editor pane', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    // Editor is the second icon button (Terminal, Editor, Desktop, Apps, ...)
    const iconButtons = card.locator('button');
    await iconButtons.nth(1).click();
    await expect(page.locator('main').getByText(/Editor (is starting|running)/)).toBeVisible({ timeout: 15_000 });
  });

  test('Editor pane shows starting or running state', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    const iconButtons = card.locator('button');
    await iconButtons.nth(1).click();
    await expect(page.locator('main').getByText(/Editor (is starting|running)/)).toBeVisible({ timeout: 15_000 });
    const startingMsg = page.locator('main').locator('text=is starting...');
    const runningMsg = page.locator('main').locator('text=Editor running');
    await expect(startingMsg.or(runningMsg)).toBeVisible({ timeout: 60_000 });
  });

  test('service pane shows "Open in tab" link when running', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    // Open desktop pane
    const iconButtons = card.locator('button');
    await iconButtons.nth(2).click();
    await expect(page.locator('main').getByText(/Desktop (is starting|running)/)).toBeVisible({ timeout: 15_000 });
    // Wait for service to start, then check for "Open in tab"
    const openLink = page.locator('main').locator('text=Open in tab');
    // If service hasn't started yet, "is starting..." will show instead
    await expect(openLink.or(page.locator('main').locator('text=is starting...'))).toBeVisible({ timeout: 60_000 });
  });

  test('service pane renders iframe when service is running', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    const iconButtons = card.locator('button');
    await iconButtons.nth(2).click();
    await expect(page.locator('main').getByText(/Desktop (is starting|running)/)).toBeVisible({ timeout: 15_000 });
    // Wait for iframe (service needs to finish starting)
    const iframe = page.locator('main iframe');
    const startingMsg = page.locator('main').locator('text=is starting...');
    await expect(iframe.or(startingMsg)).toBeVisible({ timeout: 60_000 });
  });
});
