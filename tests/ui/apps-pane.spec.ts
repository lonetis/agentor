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

    // Apps is the 3rd icon button (Terminal, Desktop, Apps, Editor, Upload, Download)
    const iconButtons = card.locator('button');
    await expect(iconButtons.nth(2)).toBeVisible();
  });

  test('clicking Apps button opens an Apps pane tab', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

    const iconButtons = card.locator('button');
    await iconButtons.nth(2).click();

    // The pane tab bar should show "Apps" label in the main area
    await expect(page.locator('main').getByRole('heading', { name: 'Apps', exact: true })).toBeVisible({ timeout: 15_000 });
  });

  test('Apps pane shows Chromium app type', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

    const iconButtons = card.locator('button');
    await iconButtons.nth(2).click();
    await expect(page.locator('main').getByRole('heading', { name: 'Apps', exact: true })).toBeVisible({ timeout: 15_000 });

    // Chromium app type card should be visible
    await expect(page.locator('main').getByText('Chromium', { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test('Apps pane shows SOCKS5 Proxy app type', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

    const iconButtons = card.locator('button');
    await iconButtons.nth(2).click();
    await expect(page.locator('main').getByRole('heading', { name: 'Apps', exact: true })).toBeVisible({ timeout: 15_000 });

    // SOCKS5 Proxy app type card should be visible
    await expect(page.locator('main').getByText('SOCKS5 Proxy', { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test('multi-instance app types have a "+ New Instance" button (singletons use Start)', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

    const iconButtons = card.locator('button');
    await iconButtons.nth(2).click();
    await expect(page.locator('main').getByRole('heading', { name: 'Apps', exact: true })).toBeVisible({ timeout: 15_000 });

    // Two multi-instance app types (chromium, socks5) → two "+ New Instance" buttons.
    const newInstanceButtons = page.locator('main').getByText('+ New Instance');
    await expect(newInstanceButtons).toHaveCount(2, { timeout: 10_000 });

    // Two singleton apps (vscode, ssh) → two "Start" buttons while stopped.
    await expect(page.locator('main [data-testid="start-vscode"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('main [data-testid="start-ssh"]')).toBeVisible({ timeout: 10_000 });
  });

  test('Apps pane lists VS Code Tunnel and SSH as singleton app types', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

    const iconButtons = card.locator('button');
    await iconButtons.nth(2).click();
    await expect(page.locator('main').getByRole('heading', { name: 'Apps', exact: true })).toBeVisible({ timeout: 15_000 });

    await expect(page.locator('main').getByText('VS Code Tunnel', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('main').getByText('SSH Server', { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test('Apps pane shows app type descriptions', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

    const iconButtons = card.locator('button');
    await iconButtons.nth(2).click();
    await expect(page.locator('main').getByRole('heading', { name: 'Apps', exact: true })).toBeVisible({ timeout: 15_000 });

    // Chromium description (bumped timeout — the /api/app-types call can
    // take longer under heavy concurrency in the dockerized runner)
    await expect(
      page.locator('main').getByText('Chromium browser with remote debugging (CDP)'),
    ).toBeVisible({ timeout: 30_000 });

    // SOCKS5 description
    await expect(
      page.locator('main').getByText('Lightweight SOCKS5 proxy via microsocks'),
    ).toBeVisible({ timeout: 30_000 });
  });

  test('pane tab label includes container name and "Apps"', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

    const iconButtons = card.locator('button');
    await iconButtons.nth(2).click();

    // Tab label format is "{containerName} - Apps"
    const tabLabel = page.locator('main').getByText(`${displayName} - Apps`);
    await expect(tabLabel).toBeVisible({ timeout: 15_000 });
  });

  test('Apps pane shows the right empty-state label per app type', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

    const iconButtons = card.locator('button');
    await iconButtons.nth(2).click();
    await expect(page.locator('main').getByRole('heading', { name: 'Apps', exact: true })).toBeVisible({ timeout: 15_000 });

    // Multi-instance apps show "No running instances".
    await expect(page.locator('main').getByText('No running instances').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('main').getByText('No running instances')).toHaveCount(2);

    // Singleton apps show "Not running".
    await expect(page.locator('main').getByText('Not running')).toHaveCount(2);
  });

  test('VS Code tunnel Start surfaces a GitHub device code in the row within 60s', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

    // Open the Apps pane.
    const iconButtons = card.locator('button');
    await iconButtons.nth(2).click();
    await expect(page.locator('main').getByRole('heading', { name: 'Apps', exact: true })).toBeVisible({ timeout: 15_000 });

    // Click Start on the VS Code Tunnel singleton row.
    const startVscode = page.locator('main [data-testid="start-vscode"]');
    await expect(startVscode).toBeVisible({ timeout: 10_000 });
    await startVscode.click();

    // The auth block (with a real `XXXX-XXXX` code) must appear within ~60s —
    // `code tunnel` prints the prompt within a few seconds on a fresh tunnel,
    // and the Apps pane polls `/api/containers/:id/apps` every 5s. If the
    // underlying agent-data volume has cached auth, the tunnel jumps straight
    // to the Connected state and we accept that too (the user doesn't need
    // to re-auth in that case).
    const authCode = page.locator('main [data-testid="vscode-auth-code"]');
    const runningHint = page.locator('main', { hasText: 'Remote - Tunnels' });

    const deadline = Date.now() + 60_000;
    let seen: 'code' | 'connected' | null = null;
    while (Date.now() < deadline) {
      if (await authCode.first().isVisible().catch(() => false)) {
        seen = 'code';
        break;
      }
      if (await runningHint.first().isVisible().catch(() => false)) {
        seen = 'connected';
        break;
      }
      await page.waitForTimeout(2_000);
    }

    expect(seen).not.toBeNull();
    if (seen === 'code') {
      const codeText = await authCode.first().textContent();
      expect(codeText?.trim()).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      // The clickable URL should also be there.
      await expect(page.locator('main a[href="https://github.com/login/device"]').first()).toBeVisible();
    }

    // Clean up: stop the tunnel so the next test isn't left with a running
    // instance (singleton apps return 409 on double-start).
    const stopBtn = page.locator('main button', { hasText: 'Stop' }).first();
    if (await stopBtn.isVisible().catch(() => false)) {
      await stopBtn.click();
    }
  });
});
