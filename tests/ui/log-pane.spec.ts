import { test, expect } from '@playwright/test';
import { goToDashboard, selectSidebarTab } from '../helpers/ui-helpers';

/**
 * Helper: open the log pane from the System tab.
 */
async function openLogPane(page: import('@playwright/test').Page) {
  await selectSidebarTab(page, 'System');
  await page.locator('.system-card-link').filter({ hasText: 'Logs' }).click();
  await expect(page.locator('.log-pane')).toBeVisible({ timeout: 10_000 });
}

test.describe('Log Pane', () => {
  test.beforeEach(async ({ page }) => {
    // Clear any persisted pane state so we start fresh
    await page.addInitScript(() => {
      const raw = localStorage.getItem('agentor-ui-state');
      if (raw) {
        try {
          const state = JSON.parse(raw);
          state.panes = { rootNode: null, focusedNodeId: null };
          localStorage.setItem('agentor-ui-state', JSON.stringify(state));
        } catch {}
      }
    });
    await goToDashboard(page);
  });

  test('Logs button visible in System tab', async ({ page }) => {
    await selectSidebarTab(page, 'System');
    const logsBtn = page.locator('.system-card-link').filter({ hasText: 'Logs' });
    await expect(logsBtn).toBeVisible({ timeout: 10_000 });
  });

  test('clicking Logs opens a log pane', async ({ page }) => {
    await openLogPane(page);
  });

  test('log pane has filter bar', async ({ page }) => {
    await openLogPane(page);

    await expect(page.locator('.log-filter-bar')).toBeVisible();
    await expect(page.getByText('Source:', { exact: true })).toBeVisible();
    await expect(page.getByText('Level:', { exact: true })).toBeVisible();
  });

  test('log pane has source filter buttons', async ({ page }) => {
    await openLogPane(page);

    await expect(page.locator('.log-filter-btn').filter({ hasText: 'Orchestrator' })).toBeVisible();
    await expect(page.locator('.log-filter-btn').filter({ hasText: 'Worker' })).toBeVisible();
    await expect(page.locator('.log-filter-btn').filter({ hasText: 'Traefik' })).toBeVisible();
  });

  test('log pane has level filter buttons', async ({ page }) => {
    await openLogPane(page);

    await expect(page.locator('.log-filter-btn').filter({ hasText: 'Debug' })).toBeVisible();
    await expect(page.locator('.log-filter-btn').filter({ hasText: 'Info' })).toBeVisible();
    await expect(page.locator('.log-filter-btn').filter({ hasText: 'Warn' })).toBeVisible();
    await expect(page.locator('.log-filter-btn').filter({ hasText: 'Error' })).toBeVisible();
  });

  test('log pane has search input', async ({ page }) => {
    await openLogPane(page);

    const searchInput = page.locator('.log-search-input');
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toHaveAttribute('placeholder', 'Search logs...');
  });

  test('log pane has status bar', async ({ page }) => {
    await openLogPane(page);

    await expect(page.locator('.log-status-bar')).toBeVisible();
    const statusText = page.locator('.log-status-text');
    await expect(statusText).toBeVisible();
    await expect(statusText).toHaveText(/Connected|Disconnected/);
  });

  test('log pane shows entries or empty state', async ({ page }) => {
    await openLogPane(page);

    // Wait for either entries to appear or the empty state message
    await expect(
      page.locator('.log-entry').first().or(page.locator('.log-empty'))
    ).toBeVisible({ timeout: 15_000 });
  });

  test('log entries have timestamp, level badge, source badge, and message', async ({ page }) => {
    await openLogPane(page);

    // Wait for entries — if none exist, skip gracefully
    const entry = page.locator('.log-entry').first();
    const hasEntries = await entry.isVisible({ timeout: 15_000 }).catch(() => false);
    test.skip(!hasEntries, 'No log entries available — cannot verify entry structure');

    await expect(entry.locator('.log-timestamp')).toBeVisible();
    await expect(entry.locator('.log-level-badge')).toBeVisible();
    await expect(entry.locator('.log-source-badge')).toBeVisible();
    await expect(entry.locator('.log-message')).toBeVisible();
  });

  test('tab bar shows Logs tab', async ({ page }) => {
    await openLogPane(page);

    const tabBar = page.locator('.pane-tab-bar');
    await expect(tabBar).toBeVisible();
    await expect(tabBar.locator('.tab-item').filter({ hasText: 'Logs' })).toBeVisible();
  });

  test('clicking Logs again re-focuses existing tab', async ({ page }) => {
    await openLogPane(page);

    // Click again — should still have exactly one Logs tab
    await page.locator('.system-card-link').filter({ hasText: 'Logs' }).click();
    const logsTabs = page.locator('.pane-tab-bar .tab-item').filter({ hasText: 'Logs' });
    await expect(logsTabs).toHaveCount(1);
  });

  test('log pane shows entry count in status bar', async ({ page }) => {
    await openLogPane(page);

    const countText = page.locator('.log-status-count');
    await expect(countText).toBeVisible();
    await expect(countText).toHaveText(/\d+ entries/);
  });

  test('source filter toggles work', async ({ page }) => {
    await openLogPane(page);

    // Click "Orch" to filter to orchestrator only
    const orchBtn = page.locator('.log-filter-btn').filter({ hasText: 'Orchestrator' });
    await orchBtn.click();

    // Button should have active class
    await expect(orchBtn).toHaveClass(/log-filter-btn-active/);
  });

  test('log pane state saved to localStorage', async ({ page }) => {
    await openLogPane(page);

    // Wait for debounced write (500ms) to flush to localStorage
    await page.waitForFunction(() => {
      const raw = localStorage.getItem('agentor-ui-state');
      if (!raw) return false;
      const state = JSON.parse(raw);
      return state?.panes?.rootNode?.tabs?.some?.((t: { type: string }) => t.type === 'logs');
    }, undefined, { timeout: 10_000 });
  });

  test('scrolling to top triggers loadMore and prepends older entries', async ({ page }) => {
    await openLogPane(page);

    // Wait for entries to populate so we have something to paginate from.
    const firstEntry = page.locator('.log-entry').first();
    const hasEntries = await firstEntry.isVisible({ timeout: 15_000 }).catch(() => false);
    test.skip(!hasEntries, 'No log entries available — cannot exercise pagination');

    const initialCount = await page.locator('.log-entry').count();
    test.skip(initialCount < 50, 'Not enough log history for pagination test');

    // Capture the first visible entry's text so we can verify older entries
    // appear ABOVE it after pagination.
    const firstEntryTextBefore = await firstEntry.textContent();

    // Scroll to top to trigger loadMore.
    await page.locator('.log-entries').evaluate((el) => { el.scrollTop = 0; });

    // Either the loading indicator flashes briefly or new entries are
    // prepended directly. Wait for either outcome by watching for an
    // increased entry count, the loading indicator, or the end-of-history
    // marker (no more pages to load).
    await Promise.race([
      page.locator('.log-pagination-indicator').waitFor({ timeout: 5_000 }).catch(() => null),
      page.waitForFunction((before) => {
        const entries = document.querySelectorAll('.log-entry');
        return entries.length > before;
      }, initialCount, { timeout: 5_000 }).catch(() => null),
    ]);
    // Allow request to settle.
    await page.waitForTimeout(500);

    const newCount = await page.locator('.log-entry').count();
    const endMarkerVisible = await page.locator('.log-pagination-end').isVisible().catch(() => false);

    // Either older entries were appended, or we hit the absolute beginning.
    expect(newCount > initialCount || endMarkerVisible).toBe(true);

    // If we paginated, the previous "first" entry should now appear later
    // in the list (older entries inserted above it).
    if (newCount > initialCount && firstEntryTextBefore) {
      const newFirstEntryText = await page.locator('.log-entry').first().textContent();
      expect(newFirstEntryText).not.toBe(firstEntryTextBefore);
    }
  });

  test('log tab can be closed', async ({ page }) => {
    await openLogPane(page);

    // Close the tab via the close button
    const closeBtn = page.locator('.pane-tab-bar .tab-item').filter({ hasText: 'Logs' }).locator('button');
    await closeBtn.click();

    // Log pane should disappear
    await expect(page.locator('.log-pane')).toBeHidden({ timeout: 10_000 });
  });
});
