import { test, expect } from '@playwright/test';
import { goToDashboard } from '../helpers/ui-helpers';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';

test.describe.serial('Apps Pane — UI', () => {
  let containerId: string;
  let displayName: string;

  test.beforeAll(async ({ request }) => {
    displayName = `AppsPane-${Date.now()}`;
    const container = await createWorker(request, { displayName });
    containerId = container.id;
  });

  test.afterAll(async ({ request }) => {
    if (containerId) {
      await cleanupWorker(request, containerId);
    }
  });

  test('Apps button exists on running container card', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

    // Apps is the 4th icon button (Terminal, Desktop, Editor, Apps)
    const iconButtons = card.locator('button').filter({ has: page.locator('svg') });
    await expect(iconButtons.nth(3)).toBeVisible();
  });

  test('clicking Apps button opens an Apps pane tab', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

    const iconButtons = card.locator('button').filter({ has: page.locator('svg') });
    await iconButtons.nth(3).click();

    // The pane tab bar should show "Apps" label in the main area
    await expect(page.locator('main').getByRole('heading', { name: 'Apps', exact: true })).toBeVisible({ timeout: 15_000 });
  });

  test('Apps pane shows Chromium app type', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

    const iconButtons = card.locator('button').filter({ has: page.locator('svg') });
    await iconButtons.nth(3).click();
    await expect(page.locator('main').getByRole('heading', { name: 'Apps', exact: true })).toBeVisible({ timeout: 15_000 });

    // Chromium app type card should be visible
    await expect(page.locator('main').getByText('Chromium', { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test('Apps pane shows SOCKS5 Proxy app type', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

    const iconButtons = card.locator('button').filter({ has: page.locator('svg') });
    await iconButtons.nth(3).click();
    await expect(page.locator('main').getByRole('heading', { name: 'Apps', exact: true })).toBeVisible({ timeout: 15_000 });

    // SOCKS5 Proxy app type card should be visible
    await expect(page.locator('main').getByText('SOCKS5 Proxy', { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test('each app type has a "+ New Instance" button', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

    const iconButtons = card.locator('button').filter({ has: page.locator('svg') });
    await iconButtons.nth(3).click();
    await expect(page.locator('main').getByRole('heading', { name: 'Apps', exact: true })).toBeVisible({ timeout: 15_000 });

    // There should be two "+ New Instance" buttons (one per app type)
    const newInstanceButtons = page.locator('main').getByText('+ New Instance');
    await expect(newInstanceButtons).toHaveCount(2, { timeout: 10_000 });
  });

  test('Apps pane shows app type descriptions', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

    const iconButtons = card.locator('button').filter({ has: page.locator('svg') });
    await iconButtons.nth(3).click();
    await expect(page.locator('main').getByRole('heading', { name: 'Apps', exact: true })).toBeVisible({ timeout: 15_000 });

    // Chromium description
    await expect(
      page.locator('main').getByText('Chromium browser with remote debugging (CDP)'),
    ).toBeVisible({ timeout: 10_000 });

    // SOCKS5 description
    await expect(
      page.locator('main').getByText('Lightweight SOCKS5 proxy via microsocks'),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('pane tab label includes container name and "Apps"', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

    const iconButtons = card.locator('button').filter({ has: page.locator('svg') });
    await iconButtons.nth(3).click();

    // Tab label format is "{containerName} - Apps"
    const tabLabel = page.locator('main').getByText(`${displayName} - Apps`);
    await expect(tabLabel).toBeVisible({ timeout: 15_000 });
  });

  test('Apps pane shows "No running instances" for each app type', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

    const iconButtons = card.locator('button').filter({ has: page.locator('svg') });
    await iconButtons.nth(3).click();
    await expect(page.locator('main').getByRole('heading', { name: 'Apps', exact: true })).toBeVisible({ timeout: 15_000 });

    // Both app types should show "No running instances" since no instances are started
    const noInstancesLabels = page.locator('main').getByText('No running instances');
    await expect(noInstancesLabels).toHaveCount(2, { timeout: 10_000 });
  });
});
