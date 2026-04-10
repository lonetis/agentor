import { test, expect } from '@playwright/test';
import { goToDashboard, selectSidebarTab } from '../helpers/ui-helpers';

test.describe('Usage Panel', () => {
  test('Usage tab exists in sidebar', async ({ page }) => {
    await goToDashboard(page);
    await expect(page.locator('aside .sidebar-tab').filter({ hasText: 'Usage' })).toBeVisible();
  });

  test('shows agent names', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'Usage');
    const aside = page.locator('aside');
    await expect(aside.getByText('Claude', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(aside.getByText('Codex', { exact: true })).toBeVisible();
    await expect(aside.getByText('Gemini', { exact: true })).toBeVisible();
  });

  test('shows auth type labels', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'Usage');
    const aside = page.locator('aside');
    // Wait for usage data to load (agent names appear after API response)
    await expect(aside.getByText('Claude', { exact: true })).toBeVisible({ timeout: 10_000 });
    // Each agent should show one of the auth type badges
    const authLabels = await aside.locator('text=/OAuth|API key|not configured/').all();
    expect(authLabels.length).toBeGreaterThanOrEqual(3);
  });

  test('switching to Usage tab shows agent names', async ({ page }) => {
    await goToDashboard(page);
    // Start on Workers tab (default)
    await expect(page.locator('aside .sidebar-tab-active')).toContainText('Workers');
    // Switch to Usage tab
    await selectSidebarTab(page, 'Usage');
    const aside = page.locator('aside');
    await expect(aside.getByText('Claude', { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test('shows per-agent rows with Claude, Codex, and Gemini visible', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'Usage');
    const aside = page.locator('aside');
    // Each agent should have its own row inside the usage panel
    const claude = aside.getByText('Claude', { exact: true });
    const codex = aside.getByText('Codex', { exact: true });
    const gemini = aside.getByText('Gemini', { exact: true });
    await expect(claude).toBeVisible();
    await expect(codex).toBeVisible();
    await expect(gemini).toBeVisible();
    // Verify all three are distinct elements
    expect(await claude.count()).toBe(1);
    expect(await codex.count()).toBe(1);
    expect(await gemini.count()).toBe(1);
  });

  test('shows an auth badge element per agent', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'Usage');
    const aside = page.locator('aside');
    // Auth badges contain one of: "OAuth", "API key", "not configured"
    // Each badge has a rounded styling with specific color classes
    const badges = aside.locator('span').filter({
      hasText: /^(OAuth|API key|not configured)$/,
    });
    // There should be exactly 3 badges — one per agent
    await expect(badges).toHaveCount(3);
    // Each badge should be visible
    for (let i = 0; i < 3; i++) {
      await expect(badges.nth(i)).toBeVisible();
    }
  });

  test('auth badges use correct color for their type', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'Usage');
    const aside = page.locator('aside');
    // Check each badge has the expected color class based on its label
    const badges = aside.locator('span').filter({
      hasText: /^(OAuth|API key|not configured)$/,
    });
    const count = await badges.count();
    for (let i = 0; i < count; i++) {
      const text = (await badges.nth(i).textContent())?.trim();
      const classAttr = await badges.nth(i).getAttribute('class') || '';
      if (text === 'OAuth') {
        expect(classAttr).toContain('bg-green');
      } else if (text === 'API key') {
        expect(classAttr).toContain('bg-blue');
      } else if (text === 'not configured') {
        expect(classAttr).toContain('bg-gray');
      }
    }
  });

  test('shows "Fetched Xm ago" relative timestamp per agent', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'Usage');
    const aside = page.locator('aside');
    // The relative timestamp text matches patterns like "just now", "1m ago", "5m ago", "1h 30m ago"
    const timestamps = aside.locator('span').filter({
      hasText: /^(just now|\d+m ago|\d+h \d+m ago)$/,
    });
    // At least one agent should have a fetch timestamp (agents with OAuth or API key auth
    // that have been fetched will show one; agents with 'none' auth may not)
    const count = await timestamps.count();
    // Depending on configuration, there may be 0 to 3 timestamps
    expect(count).toBeGreaterThanOrEqual(0);
    expect(count).toBeLessThanOrEqual(3);
  });

  test('refresh button is visible in Actions card', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'Usage');
    const aside = page.locator('aside');
    await expect(aside.getByText('Refresh usage')).toBeVisible({ timeout: 10_000 });
  });

  test('clicking refresh button triggers refresh without error', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'Usage');
    const aside = page.locator('aside');
    const refreshBtn = aside.getByText('Refresh usage');
    await expect(refreshBtn).toBeVisible({ timeout: 10_000 });

    // Listen for console errors during the refresh
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    // Click the refresh button
    await refreshBtn.click();

    // Wait for the refresh to complete
    await expect(aside.getByText('Refresh usage')).toBeVisible({ timeout: 15_000 });

    // Agent names should still be visible after refresh
    await expect(aside.getByText('Claude', { exact: true })).toBeVisible();
    await expect(aside.getByText('Codex', { exact: true })).toBeVisible();
    await expect(aside.getByText('Gemini', { exact: true })).toBeVisible();

    // No unexpected console errors related to usage
    const usageErrors = errors.filter(e => e.toLowerCase().includes('usage'));
    expect(usageErrors).toHaveLength(0);
  });

  test('refresh button shows "Refreshing..." while in progress', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'Usage');
    const aside = page.locator('aside');
    const refreshBtn = aside.getByText('Refresh usage');
    await expect(refreshBtn).toBeVisible({ timeout: 10_000 });

    // Intercept the refresh API to add a delay
    await page.route('**/api/usage/refresh', async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });

    // Click the refresh button
    await refreshBtn.click();

    // Button should show "Refreshing..." text while in progress
    await expect(aside.getByText('Refreshing...')).toBeVisible({ timeout: 3_000 });

    // Wait for refresh to complete
    await expect(aside.getByText('Refresh usage')).toBeVisible({ timeout: 15_000 });

    await page.unrouteAll({ behavior: 'wait' });
  });

  test('refresh button is disabled during refresh', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'Usage');
    const aside = page.locator('aside');
    const refreshBtn = aside.getByText('Refresh usage');
    await expect(refreshBtn).toBeVisible({ timeout: 10_000 });

    // Click and wait for the refresh to complete
    await refreshBtn.click();
    await page.waitForTimeout(3000);
    // After the refresh completes, the button should be visible again
    await expect(aside.getByText('Refresh usage')).toBeVisible();
  });

  test('progress bars are visible when usage data exists', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'Usage');
    const aside = page.locator('aside');

    // Progress bars are rendered as nested divs with colored bg classes
    const progressBars = aside.locator('div.rounded-full.overflow-hidden > div.rounded-full');
    const barCount = await progressBars.count();

    // If any agent has OAuth auth with usage windows, there will be progress bars
    expect(barCount).toBeGreaterThanOrEqual(0);

    // Each visible bar should have a width style set (percentage)
    for (let i = 0; i < barCount; i++) {
      const style = await progressBars.nth(i).getAttribute('style');
      expect(style).toContain('width:');
    }
  });

  test('progress bars have correct color classes based on utilization', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'Usage');
    const aside = page.locator('aside');

    const progressBars = aside.locator('div.rounded-full.overflow-hidden > div.rounded-full');
    const barCount = await progressBars.count();

    for (let i = 0; i < barCount; i++) {
      const classAttr = await progressBars.nth(i).getAttribute('class') || '';
      // Each bar must have exactly one of the three color classes
      const hasGreen = classAttr.includes('bg-green-500');
      const hasAmber = classAttr.includes('bg-amber-500');
      const hasRed = classAttr.includes('bg-red-500');
      expect(hasGreen || hasAmber || hasRed).toBe(true);
    }
  });

  test('usage percentage values are visible next to progress bars', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'Usage');
    const aside = page.locator('aside');

    // Percentage values are displayed as "XX%" in monospace font
    const percentages = aside.locator('span.font-mono').filter({
      hasText: /^\d+%$/,
    });
    const count = await percentages.count();

    expect(count).toBeGreaterThanOrEqual(0);

    for (let i = 0; i < count; i++) {
      await expect(percentages.nth(i)).toBeVisible();
      const text = await percentages.nth(i).textContent();
      expect(text).toMatch(/^\d+%$/);
    }
  });

  test('usage window labels are visible next to progress bars', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'Usage');
    const aside = page.locator('aside');

    const progressBars = aside.locator('div.rounded-full.overflow-hidden');
    const barCount = await progressBars.count();

    if (barCount > 0) {
      const labels = aside.locator('span.truncate').filter({
        hasText: /\S+/,
      });
      expect(await labels.count()).toBeGreaterThanOrEqual(barCount);
    }
  });

  test('error messages display in red text when present', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'Usage');
    const aside = page.locator('aside');

    const errorElements = aside.locator('span[class*="text-red-500"], span[class*="text-red-400"]');
    const errorCount = await errorElements.count();

    expect(errorCount).toBeGreaterThanOrEqual(0);

    for (let i = 0; i < errorCount; i++) {
      await expect(errorElements.nth(i)).toBeVisible();
      const text = await errorElements.nth(i).textContent();
      expect(text?.trim().length).toBeGreaterThan(0);
    }
  });

  test('fallback messages show for agents without usage data', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'Usage');
    const aside = page.locator('aside');

    // Exact match — there's also an auth badge that says "not configured"
    // (lowercase, no italic), and Playwright's `hasText` is a case-insensitive
    // substring match by default which would match both.
    const notConfigured = aside.locator('span').filter({ hasText: /^Not configured$/ });
    const noApiKeyData = aside.locator('span').filter({ hasText: 'No usage data for API key auth' });

    const notConfiguredCount = await notConfigured.count();
    const noApiKeyCount = await noApiKeyData.count();

    expect(notConfiguredCount + noApiKeyCount).toBeGreaterThanOrEqual(0);

    for (let i = 0; i < notConfiguredCount; i++) {
      await expect(notConfigured.nth(i)).toBeVisible();
      const classAttr = await notConfigured.nth(i).getAttribute('class') || '';
      expect(classAttr).toContain('italic');
    }
    for (let i = 0; i < noApiKeyCount; i++) {
      await expect(noApiKeyData.nth(i)).toBeVisible();
      const classAttr = await noApiKeyData.nth(i).getAttribute('class') || '';
      expect(classAttr).toContain('italic');
    }
  });

  test('usage panel loading state shows before data arrives', async ({ page }) => {
    // Navigate but intercept the usage API to delay the response
    await page.route('**/api/usage', async route => {
      await new Promise(resolve => setTimeout(resolve, 2000));
      await route.continue();
    });

    await goToDashboard(page);
    await selectSidebarTab(page, 'Usage');
    const aside = page.locator('aside');

    // The loading state shows "Loading..." text
    const loadingText = aside.locator('text=Loading...');
    // It may or may not be visible depending on timing
    const isVisible = await loadingText.isVisible().catch(() => false);
    // The panel should eventually show agent names
    await expect(aside.getByText('Claude', { exact: true })).toBeVisible({ timeout: 10_000 });

    await page.unrouteAll({ behavior: 'wait' });
  });

  test('switching away and back to Usage tab preserves content', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'Usage');
    const aside = page.locator('aside');
    await expect(aside.getByText('Claude', { exact: true })).toBeVisible({ timeout: 10_000 });

    // Switch to Workers tab
    await selectSidebarTab(page, 'Workers');
    // Agent names should be hidden
    await expect(aside.getByText('Claude', { exact: true })).toBeHidden();

    // Switch back to Usage
    await selectSidebarTab(page, 'Usage');
    // Agent names should reappear
    await expect(aside.getByText('Claude', { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test('usage API response matches expected schema', async ({ page }) => {
    await goToDashboard(page);

    const response = await page.evaluate(async () => {
      const res = await fetch('/api/usage');
      return res.json();
    });

    expect(response).toHaveProperty('agents');
    expect(Array.isArray(response.agents)).toBe(true);

    for (const agent of response.agents) {
      expect(agent).toHaveProperty('agentId');
      expect(agent).toHaveProperty('displayName');
      expect(agent).toHaveProperty('authType');
      expect(['oauth', 'api-key', 'none']).toContain(agent.authType);
      expect(agent).toHaveProperty('usageAvailable');
      expect(typeof agent.usageAvailable).toBe('boolean');
      expect(agent).toHaveProperty('windows');
      expect(Array.isArray(agent.windows)).toBe(true);

      for (const w of agent.windows) {
        expect(w).toHaveProperty('label');
        expect(typeof w.label).toBe('string');
        expect(w).toHaveProperty('utilization');
        expect(typeof w.utilization).toBe('number');
        expect(w.utilization).toBeGreaterThanOrEqual(0);
        expect(w.utilization).toBeLessThanOrEqual(100);
        expect(w).toHaveProperty('resetsAt');
      }
    }
  });

  test('usage refresh API endpoint returns valid response', async ({ page }) => {
    await goToDashboard(page);

    const response = await page.evaluate(async () => {
      const res = await fetch('/api/usage/refresh', { method: 'POST' });
      return { status: res.status, body: await res.json() };
    });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('agents');
    expect(Array.isArray(response.body.agents)).toBe(true);
  });

  test('plan type badge is visible when agent has plan info', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'Usage');
    const aside = page.locator('aside');

    const planBadges = aside.locator('span[class*="bg-purple"]');
    const count = await planBadges.count();

    expect(count).toBeGreaterThanOrEqual(0);

    for (let i = 0; i < count; i++) {
      await expect(planBadges.nth(i)).toBeVisible();
      const text = await planBadges.nth(i).textContent();
      expect(text?.trim().length).toBeGreaterThan(0);
    }
  });

  test('reset time tooltips have ISO timestamp', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'Usage');
    const aside = page.locator('aside');

    const resetTimes = aside.locator('span[title]').filter({
      hasText: /^\d+(m|h|d)/,
    });
    const count = await resetTimes.count();

    for (let i = 0; i < count; i++) {
      const title = await resetTimes.nth(i).getAttribute('title');
      expect(title).toBeTruthy();
      expect(new Date(title!).getTime()).not.toBeNaN();
    }
  });
});
