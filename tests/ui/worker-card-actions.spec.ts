import { test, expect } from '@playwright/test';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';
import { goToDashboard, hasButtonWithTooltip, findButtonByTooltip } from '../helpers/ui-helpers';

test.describe('Worker card actions', () => {
  let workerId: string;
  let displayName: string;

  test.beforeAll(async ({ request }) => {
    displayName = `Card-${Date.now()}`;
    const w = await createWorker(request, { displayName });
    workerId = w.id;
  });

  test.afterAll(async ({ request }) => {
    if (workerId) await cleanupWorker(request, workerId);
  });

  test('a running card exposes the Export button (in the workspace group)', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    expect(await hasButtonWithTooltip(card, page, 'Export worker')).toBe(true);
  });

  test('Export shows a loading state while preparing, then downloads', async ({ page }) => {
    // Simulate the slow server-side bundle materialisation so the button's
    // in-progress state is observable before the download triggers.
    await page.route('**/api/containers/*/export*', async (route) => {
      await new Promise((r) => setTimeout(r, 1200));
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'application/x-tar',
          'content-disposition': 'attachment; filename="card-worker-export.tar"',
        },
        body: 'dummy-tar-bundle',
      });
    });

    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    const exportBtn = await findButtonByTooltip(card, page, 'Export worker');

    const downloadPromise = page.waitForEvent('download');
    await exportBtn.click();
    // While the bundle is being prepared the button is disabled (spinner shown).
    await expect(exportBtn).toBeDisabled();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('worker-export.tar');
    // Re-enabled once the download has been triggered.
    await expect(exportBtn).toBeEnabled({ timeout: 5_000 });
  });

  test('the action row is horizontally scrollable (no wrap)', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    const actions = card.locator('.card-actions');
    await expect(actions).toBeVisible();
    const overflowX = await actions.evaluate((el) => getComputedStyle(el).overflowX);
    expect(overflowX).toBe('auto');
  });

  test('per-worker live metrics render on the card', async ({ page }) => {
    await page.route('**/api/worker-metrics', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          workers: [{
            workerId,
            containerName: `agentor-worker-${workerId}`,
            displayName,
            status: 'running',
            cpuUtilization: 42,
            memoryUsedBytes: 1024 ** 3,
            memoryLimitBytes: 4 * 1024 ** 3,
            memoryUtilization: 25,
            diskUsedBytes: 2 * 1024 ** 3,
            netRxBytesPerSec: 1024,
            netTxBytesPerSec: 2048,
            blkReadBytesPerSec: 0,
            blkWriteBytesPerSec: 0,
            lastChecked: new Date().toISOString(),
          }],
        }),
      });
    });

    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    const metrics = card.locator('[data-testid="worker-metrics"]');
    await expect(metrics).toBeVisible({ timeout: 10_000 });
    // CPU as a percentage; memory + disk as used byte sizes (no percentage).
    await expect(metrics).toContainText('42%');
    await expect(metrics).toContainText('1.0 GB'); // memory used
    await expect(metrics).toContainText('2.0 GB'); // disk used
  });
});
