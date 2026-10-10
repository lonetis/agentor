import { test, expect } from '@playwright/test';
import { goToDashboard } from '../helpers/ui-helpers';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';
import { TerminalWsClient } from '../helpers/terminal-ws';
import { ApiClient } from '../helpers/api-client';

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
    await expect(page.locator('.xterm-helper-textarea:visible')).toBeFocused();
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
    await expect(page.locator('.xterm-helper-textarea:visible')).toBeFocused();
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

  test('clicking Terminal button twice opens two terminal tabs for the same worker', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

    const buttons = card.locator('button');
    // First click — opens the terminal pane
    await buttons.first().click();
    await expect(page.locator('.xterm')).toBeVisible({ timeout: 15_000 });

    const terminalTabs = page.locator('.pane-tab-bar .tab-item').filter({ hasText: `${displayName} - Terminal` });
    await expect(terminalTabs).toHaveCount(1);

    // Second click — should open a second, independent terminal tab
    await buttons.first().click();
    await expect(terminalTabs).toHaveCount(2);
    await expect(page.locator('.xterm-helper-textarea:visible')).toBeFocused();

    // Returning to an existing terminal tab restores keyboard input.
    await terminalTabs.first().click();
    await expect(page.locator('.xterm-helper-textarea:visible')).toBeFocused();
    await terminalTabs.last().click();
    await expect(page.locator('.xterm-helper-textarea:visible')).toBeFocused();

    // Closing one tab must not remove the sibling
    await terminalTabs.first().locator('button').click();
    await expect(terminalTabs).toHaveCount(1);
    await expect(page.locator('.xterm')).toBeVisible();
  });

  test('keyboard tmux activation focuses the terminal in another split group', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { status } = await api.createPane(containerId, 'keyboard-focus');
    expect(status).toBe(201);

    // Restore two visible terminal groups, with the second group focused.
    await page.addInitScript(({ containerId, displayName }) => {
      const children = [0, 1].map(index => {
        const tab = {
          id: `keyboard-terminal-${index}`, type: 'terminal',
          containerId, containerName: displayName,
        };
        return {
          id: `keyboard-group-${index}`, sizeFraction: 0.5,
          tabs: [tab], activeTabId: tab.id,
        };
      });
      localStorage.setItem('agentor-ui-state', JSON.stringify({
        panes: {
          rootNode: { id: 'keyboard-root', sizeFraction: 1, direction: 'horizontal', children },
          focusedNodeId: children[1]!.id,
        },
      }));
    }, { containerId, displayName });

    await goToDashboard(page);
    const tabBars = page.locator('.tmux-tab-bar');
    await expect(tabBars).toHaveCount(2);
    await expect(page.locator('.xterm-helper-textarea:visible')).toHaveCount(2);
    await expect(page.locator('.xterm-helper-textarea:visible').last()).toBeFocused();

    // Keyboard focus alone should leave the tmux button available for Enter.
    const targetTab = tabBars.first().locator('.tmux-tab').filter({ hasText: 'keyboard-focus' });
    await targetTab.focus();
    await expect(targetTab).toBeFocused();
    await targetTab.press('Enter');
    await expect(targetTab).toHaveClass(/active/);
    const firstPane = tabBars.first().locator('..');
    await expect(firstPane.locator('.xterm-helper-textarea:visible')).toBeFocused();

    await page.keyboard.type("printf 'KEYBOARD_%s\\n' FOCUS_OK");
    await page.keyboard.press('Enter');
    await expect(firstPane.locator('.xterm-rows:visible')).toContainText('KEYBOARD_FOCUS_OK');

    // Creating a window with Enter also activates the other group.
    const createField = tabBars.last().locator('.tmux-create-field');
    await createField.focus();
    await createField.fill('keyboard-created');
    await createField.press('Enter');
    await expect(tabBars.last().locator('.tmux-tab.active')).toContainText('keyboard-created');
    await expect(tabBars.last().locator('..').locator('.xterm-helper-textarea:visible')).toBeFocused();
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

      // Activation focuses the terminal without an extra click in its content.
      await expect(page.locator('.xterm-helper-textarea:visible')).toBeFocused();

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
