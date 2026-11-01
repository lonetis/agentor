import { test, expect } from '@playwright/test';
import { goToDashboard } from '../helpers/ui-helpers';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';

test.describe.serial('Split Pane Layout', () => {
  let containerId: string;
  let displayName: string;

  test.beforeAll(async ({ request }) => {
    displayName = `Split-${Date.now()}`;
    const container = await createWorker(request, { displayName });
    containerId = container.id;
  });

  test.afterAll(async ({ request }) => {
    await cleanupWorker(request, containerId);
  });

  test('shows placeholder when no panes open', async ({ page }) => {
    await goToDashboard(page);
    // The main area should show the placeholder text
    await expect(page.locator('main').locator('text=Create a worker')).toBeVisible();
  });

  test('opens a terminal and hides placeholder', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

    // Click Terminal button
    const buttons = card.locator('button');
    await buttons.first().click();

    // Terminal should appear
    await expect(page.locator('.xterm')).toBeVisible({ timeout: 15_000 });
  });

  test('pane tab bar shows container name', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

    const buttons = card.locator('button');
    await buttons.first().click();
    await expect(page.locator('.xterm')).toBeVisible({ timeout: 15_000 });

    // The pane tab bar should show the container display name
    const mainContent = page.locator('main');
    await expect(mainContent.locator(`text=${displayName}`)).toBeVisible({ timeout: 10_000 });
  });

  test('pane tabs are exposed as ARIA tabs with a named close button', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    await card.locator('button').first().click();
    await expect(page.locator('.xterm')).toBeVisible({ timeout: 15_000 });

    const label = `${displayName} - Terminal`;
    await expect(page.getByRole('tablist', { name: 'Open panes' })).toBeVisible();
    const tab = page.locator('main .pane-tab-bar .tab-item').first();
    await expect(tab).toHaveAttribute('role', 'tab');
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(tab).toHaveAttribute('tabindex', '0');
    await expect(tab.locator('button.pane-tab-close')).toHaveAccessibleName(`Close ${label}`);
  });

  test('arrow keys move between pane tabs', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    // Two Terminal tabs for the same worker; the second one is active.
    await card.locator('button').first().click();
    await card.locator('button').first().click();
    const tabs = page.locator('main .pane-tab-bar .tab-item');
    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');

    await tabs.nth(1).focus();
    await page.keyboard.press('ArrowLeft');

    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'false');
    await expect(tabs.nth(0)).toBeFocused();
  });
});
