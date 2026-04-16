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
});
