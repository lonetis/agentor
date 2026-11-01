import { test, expect, type Page, type Request } from '@playwright/test';
import { goToDashboard, selectSidebarTab } from '../helpers/ui-helpers';

/**
 * Client-side polling: one shared timer per data set, paused while the page is
 * hidden or the hosting pane tab is not shown, refreshed at once when the pause
 * ended after the data went stale.
 *
 * Absence of requests can only be shown by waiting, so these tests wait a bit
 * longer than one poll interval (10 s for the worker list, 5 s for the Desktop
 * status) and compare request counts.
 */

function isWorkerListRequest(req: Request): boolean {
  return req.method() === 'GET' && new URL(req.url()).pathname === '/api/containers';
}

async function setPageVisibility(page: Page, state: 'hidden' | 'visible'): Promise<void> {
  await page.evaluate((visibility) => {
    Object.defineProperty(document, 'visibilityState', { value: visibility, configurable: true });
    Object.defineProperty(document, 'hidden', { value: visibility === 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

test.describe('Polling', () => {
  test('the worker list is polled by a single shared timer', async ({ page }) => {
    const polls: number[] = [];
    page.on('request', (req) => {
      if (isWorkerListRequest(req)) polls.push(Date.now());
    });

    const firstLoad = page.waitForResponse((res) => isWorkerListRequest(res.request()));
    await goToDashboard(page);
    await firstLoad;
    const settledAt = Date.now();

    await page.waitForTimeout(12_000);

    const windowPolls = polls.filter((t) => t > settledAt);
    // The next poll is due 10 s after the first load. Several per-component
    // pollers would each add a request, at nearly the same moment.
    expect(windowPolls.length).toBeGreaterThanOrEqual(1);
    expect(windowPolls.length).toBeLessThanOrEqual(2);
    for (let i = 1; i < windowPolls.length; i++) {
      expect(windowPolls[i]! - windowPolls[i - 1]!).toBeGreaterThan(5_000);
    }
  });

  test('polling pauses while the page is hidden and refreshes when it is shown again', async ({ page }) => {
    const polls: number[] = [];
    page.on('request', (req) => {
      if (isWorkerListRequest(req)) polls.push(Date.now());
    });

    const firstLoad = page.waitForResponse((res) => isWorkerListRequest(res.request()));
    await goToDashboard(page);
    await firstLoad;

    // The next poll is due ~10 s after the response that just arrived; hiding
    // the page now must cancel it.
    await setPageVisibility(page, 'hidden');
    const pollsWhenHidden = polls.length;
    await page.waitForTimeout(12_000);
    expect(polls.length).toBe(pollsWhenHidden);

    // The list is older than one interval by now, so showing the page
    // refreshes it right away instead of waiting for the next tick.
    const refreshed = page.waitForRequest(isWorkerListRequest, { timeout: 3_000 });
    await setPageVisibility(page, 'visible');
    await refreshed;
  });

  test('a pane tab stops polling while another tab of its group is shown', async ({ page }) => {
    // A Desktop tab for a worker that does not exist: its status endpoint is
    // stubbed, so no real worker is needed.
    const workerId = `polling-probe-${Date.now()}`;
    const statusPath = `/api/containers/${workerId}/desktop/status`;
    const isStatusRequest = (req: Request) => new URL(req.url()).pathname === statusPath;

    await page.route((url) => url.pathname === statusPath, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ running: false }) }),
    );
    const statusPolls: number[] = [];
    page.on('request', (req) => {
      if (isStatusRequest(req)) statusPolls.push(Date.now());
    });

    // Restore a layout with the Desktop tab open (same shape the app persists).
    await page.addInitScript((id) => {
      let state: Record<string, unknown> = {};
      try {
        state = JSON.parse(localStorage.getItem('agentor-ui-state') ?? '{}') as Record<string, unknown>;
      } catch {
        state = {};
      }
      state.panes = {
        rootNode: {
          id: 'node-1-polling',
          sizeFraction: 1,
          activeTabId: 'desktop-1-polling',
          tabs: [{ id: 'desktop-1-polling', containerId: id, containerName: 'Polling probe', type: 'desktop' }],
        },
        focusedNodeId: 'node-1-polling',
      };
      localStorage.setItem('agentor-ui-state', JSON.stringify(state));
    }, workerId);

    const firstStatus = page.waitForResponse((res) => isStatusRequest(res.request()));
    await goToDashboard(page);
    const desktopStarting = page.locator('main').getByText('Desktop is starting...');
    await expect(desktopStarting).toBeVisible({ timeout: 10_000 });
    await firstStatus;

    // Opening Logs in the same group hides the Desktop tab (it stays mounted).
    await selectSidebarTab(page, 'System');
    await page.locator('.system-card-link').filter({ hasText: 'Logs' }).click();
    await expect(page.locator('.log-pane')).toBeVisible({ timeout: 10_000 });
    await expect(desktopStarting).toBeHidden();

    const pollsWhenHidden = statusPolls.length;
    await page.waitForTimeout(7_000);
    expect(statusPolls.length).toBe(pollsWhenHidden);

    // Back on the Desktop tab, the stale status is fetched right away.
    const refreshed = page.waitForRequest(isStatusRequest, { timeout: 3_000 });
    await page.locator('.pane-tab-bar .tab-item').filter({ hasText: 'Polling probe - Desktop' }).click();
    await refreshed;
    await expect(desktopStarting).toBeVisible();
  });
});
