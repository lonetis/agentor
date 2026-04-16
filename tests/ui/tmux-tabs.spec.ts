import { test, expect } from '@playwright/test';
import { goToDashboard } from '../helpers/ui-helpers';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';
import { ApiClient } from '../helpers/api-client';

test.describe.serial('Tmux Tabs', () => {
  let containerId: string;
  let displayName: string;

  test.beforeAll(async ({ request }) => {
    displayName = `Tmux-${Date.now()}`;
    const container = await createWorker(request, { displayName });
    containerId = container.id;
    // Wait for tmux to be fully ready — verify we can actually CREATE a window
    const api = new ApiClient(request);
    const start = Date.now();
    while (Date.now() - start < 60_000) {
      const { status } = await api.listPanes(containerId);
      if (status !== 200) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      const { status: createStatus, body } = await api.createPane(containerId, 'readiness-probe');
      if (createStatus === 201) {
        await api.deletePane(containerId, body.index);
        break;
      }
      await new Promise(r => setTimeout(r, 2000));
    }
  });

  test.afterAll(async ({ request }) => {
    if (containerId) {
      await cleanupWorker(request, containerId);
    }
  });

  test('API: list tmux windows returns at least the main window', async ({ request }) => {
    const api = new ApiClient(request);
    const { status, body } = await api.listPanes(containerId);
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    const mainWindow = body.find((w: { name: string }) => w.name === 'main');
    expect(mainWindow).toBeTruthy();
  });

  test('API: create a new tmux window with custom name', async ({ request }) => {
    const api = new ApiClient(request);
    const { status, body } = await api.createPane(containerId, 'test-tab');
    expect(status).toBe(201);
    expect(body.name).toBe('test-tab');
    expect(typeof body.index).toBe('number');

    // Verify it appears in the list
    const { body: windows } = await api.listPanes(containerId);
    const found = windows.find((w: { name: string }) => w.name === 'test-tab');
    expect(found).toBeTruthy();
  });

  test('API: create a new tmux window with auto-generated name', async ({ request }) => {
    const api = new ApiClient(request);
    const { status, body } = await api.createPane(containerId);
    expect(status).toBe(201);
    expect(body.name).toBeTruthy();
    expect(body.name.startsWith('shell-')).toBe(true);

    // Cleanup
    await api.deletePane(containerId, body.index);
  });

  test('API: rename a tmux window', async ({ request }) => {
    const api = new ApiClient(request);
    // Find the test-tab we created earlier
    const { body: windows } = await api.listPanes(containerId);
    const testTab = windows.find((w: { name: string }) => w.name === 'test-tab');
    expect(testTab).toBeTruthy();

    const { status } = await api.renamePane(containerId, testTab.index, 'renamed-tab');
    expect(status).toBe(200);

    const { body: updatedWindows } = await api.listPanes(containerId);
    const found = updatedWindows.find((w: { name: string }) => w.name === 'renamed-tab');
    expect(found).toBeTruthy();
    const old = updatedWindows.find((w: { name: string }) => w.name === 'test-tab');
    expect(old).toBeFalsy();
  });

  test('API: close a tmux window', async ({ request }) => {
    const api = new ApiClient(request);
    // Find the renamed-tab
    const { body: windows } = await api.listPanes(containerId);
    const renamedTab = windows.find((w: { name: string }) => w.name === 'renamed-tab');
    expect(renamedTab).toBeTruthy();

    const { status } = await api.deletePane(containerId, renamedTab.index);
    expect(status).toBe(200);

    const { body: updatedWindows } = await api.listPanes(containerId);
    const found = updatedWindows.find((w: { name: string }) => w.name === 'renamed-tab');
    expect(found).toBeFalsy();
  });

  test('API: cannot close the main tmux window', async ({ request }) => {
    const api = new ApiClient(request);
    const { status } = await api.deletePane(containerId, 0);
    expect(status).toBeGreaterThanOrEqual(400);
  });

  test('API: rename with invalid characters returns error', async ({ request }) => {
    const api = new ApiClient(request);
    // Create a window first
    const { body: created } = await api.createPane(containerId, 'temp-win');
    const { status } = await api.renamePane(containerId, created.index, 'invalid name!');
    expect(status).toBeGreaterThanOrEqual(400);
    // Cleanup
    await api.deletePane(containerId, created.index);
  });

  test('UI: terminal opens when clicking container', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

    // Click the Terminal button (not h3 which opens detail modal)
    await card.locator('button').first().click();
    // Terminal pane should appear (xterm container)
    await expect(page.locator('.xterm')).toBeVisible({ timeout: 15_000 });
  });

  test('UI: tmux tab bar is visible with main tab', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    await card.locator('button').first().click();
    await expect(page.locator('.xterm')).toBeVisible({ timeout: 15_000 });

    // Tmux tab bar should show the main tab
    await expect(page.locator('text=main').first()).toBeVisible({ timeout: 15_000 });
  });
});
