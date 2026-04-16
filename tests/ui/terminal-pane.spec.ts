import { test, expect } from '@playwright/test';
import { goToDashboard } from '../helpers/ui-helpers';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';
import { TerminalWsClient } from '../helpers/terminal-ws';

test.describe.serial('Terminal Pane', () => {
  let containerId: string;
  let displayName: string;

  test.beforeAll(async ({ request }) => {
    displayName = `Term-${Date.now()}`;
    const container = await createWorker(request, { displayName });
    containerId = container.id;
  });

  test.afterAll(async ({ request }) => {
    await cleanupWorker(request, containerId);
  });

  test('opens terminal when clicking Terminal button', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

    // Click the first icon button (Terminal)
    const buttons = card.locator('button');
    await buttons.first().click();

    // Should see the xterm terminal area
    await expect(page.locator('.xterm')).toBeVisible({ timeout: 15_000 });
  });

  test('shows tmux tab bar with main tab', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

    const buttons = card.locator('button');
    await buttons.first().click();

    await expect(page.locator('.xterm')).toBeVisible({ timeout: 15_000 });
    // "main" should appear in the tmux tab bar (in the main content area)
    await expect(page.locator('main').locator('text=main')).toBeVisible({ timeout: 15_000 });
  });

  test('terminal renders xterm rows', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

    const buttons = card.locator('button');
    await buttons.first().click();

    await expect(page.locator('.xterm')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.xterm-rows')).toBeVisible({ timeout: 15_000 });
  });

  test('shows tmux create button', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

    const buttons = card.locator('button');
    await buttons.first().click();

    await expect(page.locator('.xterm')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.tmux-create-btn')).toBeVisible({ timeout: 15_000 });
  });

  test('clicking + creates a new tmux tab', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

    const buttons = card.locator('button');
    await buttons.first().click();

    await expect(page.locator('.xterm')).toBeVisible({ timeout: 15_000 });

    // Ensure main tab is visible
    const mainArea = page.locator('main');
    await expect(mainArea.locator('text=main')).toBeVisible({ timeout: 15_000 });

    // Click the create button
    await page.locator('.tmux-create-btn').click();

    // Wait for the new tab to appear (API call + 3s poll interval)
    await expect(mainArea.locator('.tmux-tab').nth(1)).toBeVisible({ timeout: 15_000 });
  });

  test('non-default tab has close button', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

    const buttons = card.locator('button');
    await buttons.first().click();

    await expect(page.locator('.xterm')).toBeVisible({ timeout: 15_000 });
    // Wait for the second tab (created in previous serial test) to be visible
    const secondTab = page.locator('.tmux-tab').nth(1);
    await expect(secondTab).toBeVisible({ timeout: 15_000 });
    // Non-default tabs should have a close button
    const closeBtn = secondTab.locator('.tmux-tab-close');
    await expect(closeBtn).toBeVisible();
  });

  test('main tab has no close button', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

    const buttons = card.locator('button');
    await buttons.first().click();

    await expect(page.locator('.xterm')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('main').locator('text=main')).toBeVisible({ timeout: 15_000 });

    // The main tab should not have a close button (× symbol)
    const mainTab = page.locator('.tmux-tab').filter({ hasText: 'main' }).first();
    await expect(mainTab).toBeVisible();
    const closeBtn = mainTab.locator('.tmux-tab-close');
    await expect(closeBtn).toBeHidden();
  });

  test('typing in terminal produces output via WebSocket', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

    const buttons = card.locator('button');
    await buttons.first().click();

    await expect(page.locator('.xterm')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.xterm-rows')).toBeVisible({ timeout: 15_000 });

    // Open a parallel WebSocket connection to verify typed commands produce output
    const ws = new TerminalWsClient(containerId);
    try {
      await ws.connect();
      await ws.waitForOutput(/[\$#>]\s*$/, 15_000);
      ws.clearBuffer();

      // Click on the xterm canvas to focus it
      await page.locator('.xterm').click();

      // Type a command via the browser keyboard
      const marker = `UITYPE_${Date.now()}`;
      await page.keyboard.type(`echo ${marker}`, { delay: 30 });
      await page.keyboard.press('Enter');

      // Verify the command output appears on the WebSocket
      await ws.waitForOutput(new RegExp(marker), 15_000);
      expect(ws.getBuffer()).toContain(marker);
    } finally {
      ws.close();
    }
  });
});
