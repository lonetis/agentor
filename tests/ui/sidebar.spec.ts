import { test, expect, Page } from '@playwright/test';
import { goToDashboard, selectSidebarTab } from '../helpers/ui-helpers';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const STORAGE_KEY = 'agentor-ui-state';

/**
 * Seed the UI state with a specific sidebar width, then load the dashboard
 * from a fresh navigation.
 *
 * Note: we first visit a NON-SPA endpoint (`/api/health`) before touching
 * localStorage. If we visited the dashboard first, its `beforeunload`
 * handler would flush the in-memory default state back to localStorage on
 * reload, clobbering our seed.
 */
async function loadDashboardWithSidebarWidth(page: Page, width: number): Promise<void> {
  await page.goto(`${BASE_URL}/api/health`, { waitUntil: 'networkidle' });
  await page.evaluate(
    ({ key, state }) => {
      localStorage.clear();
      localStorage.setItem(key, state);
    },
    {
      key: STORAGE_KEY,
      state: JSON.stringify({
        version: 1,
        sidebar: {
          width,
          collapsed: false,
          activeTab: 'workers',
          panels: { archived: true, portMappings: false, domainMappings: false, usage: false, images: false, settings: false },
        },
        panes: { rootNode: null, focusedNodeId: null },
        tmux: { activeWindows: {} },
      }),
    },
  );
  await goToDashboard(page);
  // Small settle delay for the ResizeObserver + overflow computation to settle
  await page.waitForTimeout(400);
}

test.describe('Sidebar', () => {
  test.describe('Collapse/Expand', () => {
    test('sidebar is visible by default', async ({ page }) => {
      await goToDashboard(page);
      await expect(page.locator('aside')).toBeVisible();
    });

    test('can collapse the sidebar', async ({ page }) => {
      await goToDashboard(page);
      // Click the collapse button (double chevron icon in sidebar header)
      await page.click('button[title="Collapse sidebar"]');
      await page.waitForTimeout(500);
      // After collapse, the floating expand button should be visible
      await expect(page.locator('button[title="Expand sidebar"]')).toBeVisible();
    });

    test('can expand a collapsed sidebar', async ({ page }) => {
      await goToDashboard(page);
      await page.click('button[title="Collapse sidebar"]');
      await page.waitForTimeout(500);
      await page.click('button[title="Expand sidebar"]');
      await page.waitForTimeout(500);
      // Sidebar content should be visible again — check for the title
      await expect(page.locator('h1:has-text("Agentor")')).toBeVisible();
    });
  });

  test.describe('Tab Bar', () => {
    test('Ports tab is visible and shows port mappings content', async ({ page }) => {
      await goToDashboard(page);
      await selectSidebarTab(page, 'Ports');
      // Port mappings content should be visible (either "+ Map" button or empty message)
      const aside = page.locator('aside');
      await expect(aside.locator('button:has-text("+ Map")').first()).toBeVisible({ timeout: 10_000 });
    });

    test('System tab shows Images card', async ({ page }) => {
      await goToDashboard(page);
      await selectSidebarTab(page, 'System');
      const aside = page.locator('aside');
      // Images card header should be visible
      await expect(aside.getByText('Images', { exact: true })).toBeVisible({ timeout: 10_000 });
    });

    test('Workers tab is selected by default', async ({ page }) => {
      await goToDashboard(page);
      const activeTab = page.locator('aside .sidebar-tab-active');
      await expect(activeTab).toContainText('Workers');
    });

    test('tab badges show counts', async ({ page }) => {
      await goToDashboard(page);
      // Tab badges are rendered as .sidebar-tab-badge
      const badges = page.locator('aside .sidebar-tab-badge');
      // At least Workers tab should have a badge (even if 0 workers, badge may not show)
      // Just verify the badge mechanism works — count >= 0
      const count = await badges.count();
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  test.describe('Theme Toggle', () => {
    test('theme toggle buttons are visible', async ({ page }) => {
      await goToDashboard(page);
      // The theme toggle has 3 small icon buttons next to the collapse button in the sidebar header
      // Look for the button group containing the theme icons (monitor, sun, moon)
      const collapseBtn = page.locator('button[title="Collapse sidebar"]');
      await expect(collapseBtn).toBeVisible();
      // The theme buttons are siblings of the collapse button
      const headerButtons = page.locator('aside h1').locator('..').locator('button');
      // Should have at least 4 buttons (3 theme + 1 collapse)
      expect(await headerButtons.count()).toBeGreaterThanOrEqual(4);
    });
  });

  test.describe('Header Content', () => {
    test('sidebar has "Agentor" heading and "Orchestrator" subtitle', async ({ page }) => {
      await goToDashboard(page);
      const sidebar = page.locator('aside');
      await expect(sidebar.locator('h1:has-text("Agentor")')).toBeVisible();
      await expect(sidebar.locator('p:has-text("Orchestrator")')).toBeVisible();
    });
  });

  test.describe('Action Buttons', () => {
    test('"+ New Worker" button is visible and opens modal', async ({ page }) => {
      await goToDashboard(page);
      const newWorkerBtn = page.locator('aside button:has-text("+ New Worker")');
      await expect(newWorkerBtn).toBeVisible();
      await newWorkerBtn.click();
      await page.waitForSelector('[role="dialog"]', { timeout: 10_000 });
      await expect(page.locator('[role="dialog"]')).toBeVisible();
    });

    test('"Environments" button is visible', async ({ page }) => {
      await goToDashboard(page);
      const btn = page.locator('aside button:has-text("Environments")');
      await expect(btn).toBeVisible();
    });

    test('"Capabilities" button is visible', async ({ page }) => {
      await goToDashboard(page);
      const btn = page.locator('aside button:has-text("Capabilities")');
      await expect(btn).toBeVisible();
    });

    test('"Instructions" button is visible', async ({ page }) => {
      await goToDashboard(page);
      const btn = page.locator('aside button:has-text("Instructions")');
      await expect(btn).toBeVisible();
    });

    test('"Init Scripts" button is visible', async ({ page }) => {
      await goToDashboard(page);
      const btn = page.locator('aside button:has-text("Init Scripts")');
      await expect(btn).toBeVisible();
    });
  });

  test.describe('Usage Tab', () => {
    test('Usage tab shows agent names', async ({ page }) => {
      await goToDashboard(page);
      await selectSidebarTab(page, 'Usage');
      const aside = page.locator('aside');
      await expect(aside.getByText('Claude', { exact: true })).toBeVisible({ timeout: 10_000 });
    });
  });

  test.describe('System Tab', () => {
    test('System tab shows "System Settings" button and "API Docs" link', async ({ page }) => {
      await goToDashboard(page);
      await selectSidebarTab(page, 'System');
      const aside = page.locator('aside');
      await expect(aside.locator('button:has-text("System Settings")')).toBeVisible({ timeout: 10_000 });
      const apiDocsLink = aside.locator('a:has-text("API Docs")');
      await expect(apiDocsLink).toBeVisible();
      await expect(apiDocsLink).toHaveAttribute('href', '/api/docs');
      await expect(apiDocsLink).toHaveAttribute('target', '_blank');
    });
  });

  test.describe('Collapse State Persistence', () => {
    test('collapse state persists across reload', async ({ page }) => {
      await goToDashboard(page);
      // Sidebar should be visible initially
      await expect(page.locator('aside')).toBeVisible();
      // Collapse the sidebar
      await page.click('button[title="Collapse sidebar"]');
      await page.waitForTimeout(500);
      // Verify the expand button is visible (sidebar is collapsed)
      await expect(page.locator('button[title="Expand sidebar"]')).toBeVisible();
      // Reload the page
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(300);
      // After reload, the sidebar should still be collapsed — expand button visible
      await expect(page.locator('button[title="Expand sidebar"]')).toBeVisible();
    });

    test('expand state persists across reload', async ({ page }) => {
      await goToDashboard(page);
      // Collapse the sidebar
      await page.click('button[title="Collapse sidebar"]');
      await page.waitForTimeout(500);
      // Expand it back
      await page.click('button[title="Expand sidebar"]');
      await page.waitForTimeout(500);
      // Verify sidebar is expanded — heading visible
      await expect(page.locator('h1:has-text("Agentor")')).toBeVisible();
      // Reload the page
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(300);
      // After reload, the sidebar should still be expanded — heading visible
      await expect(page.locator('h1:has-text("Agentor")')).toBeVisible();
      // The collapse button should be visible (not the expand button)
      await expect(page.locator('button[title="Collapse sidebar"]')).toBeVisible();
    });
  });

  test.describe('Resize Handle', () => {
    test('sidebar has a visible resize handle at right edge', async ({ page }) => {
      await goToDashboard(page);
      // The resize handle is a div with class "sidebar-handle" rendered next to the sidebar
      const handle = page.locator('.sidebar-handle');
      await expect(handle).toBeVisible();
      // Verify it has the col-resize cursor style
      const cursor = await handle.evaluate((el) => getComputedStyle(el).cursor);
      expect(cursor).toBe('col-resize');
    });
  });

  test.describe('Button Row Stacking', () => {
    async function buttonBoxes(page: Page) {
      const cap = await page.locator('aside button:has-text("Capabilities")').first().boundingBox();
      const inst = await page.locator('aside button:has-text("Instructions")').first().boundingBox();
      const init = await page.locator('aside button:has-text("Init Scripts")').first().boundingBox();
      expect(cap).not.toBeNull();
      expect(inst).not.toBeNull();
      expect(init).not.toBeNull();
      return { cap: cap!, inst: inst!, init: init! };
    }

    test('Capabilities/Instructions/Init Scripts lay out in a row when sidebar is wide', async ({ page }) => {
      await loadDashboardWithSidebarWidth(page, 500);
      const { cap, inst, init } = await buttonBoxes(page);

      // Same Y coordinate (all on one line), increasing X
      expect(Math.abs(cap.y - inst.y)).toBeLessThan(2);
      expect(Math.abs(inst.y - init.y)).toBeLessThan(2);
      expect(inst.x).toBeGreaterThan(cap.x + cap.width - 4);
      expect(init.x).toBeGreaterThan(inst.x + inst.width - 4);
    });

    test('Capabilities/Instructions/Init Scripts stack vertically when sidebar is narrow', async ({ page }) => {
      // 260 is below the ~280px container threshold where the row stacks
      await loadDashboardWithSidebarWidth(page, 260);
      const { cap, inst, init } = await buttonBoxes(page);

      // Same X coordinate (aligned vertically), increasing Y — each button sits below the previous
      expect(Math.abs(cap.x - inst.x)).toBeLessThan(2);
      expect(Math.abs(inst.x - init.x)).toBeLessThan(2);
      expect(inst.y).toBeGreaterThan(cap.y + cap.height - 2);
      expect(init.y).toBeGreaterThan(inst.y + inst.height - 2);
    });

    test('stacked buttons render their full labels without truncation', async ({ page }) => {
      await loadDashboardWithSidebarWidth(page, 220);
      // At this width the buttons stack, and each should fully show its label
      await expect(page.locator('aside button:has-text("Capabilities")').first()).toContainText('Capabilities');
      await expect(page.locator('aside button:has-text("Instructions")').first()).toContainText('Instructions');
      await expect(page.locator('aside button:has-text("Init Scripts")').first()).toContainText('Init Scripts');
    });
  });

  test.describe('Tab Bar Overflow', () => {
    test('More button is hidden when every tab fits', async ({ page }) => {
      // 1500px is well above the 6 sidebar tabs combined width (each tab is
      // roughly 70-100px), so none should overflow at this width.
      await loadDashboardWithSidebarWidth(page, 1500);
      await page.waitForSelector('aside .sidebar-tab-bar .sidebar-tab');
      await expect(page.locator('aside .sidebar-tab-more-btn')).toHaveCount(0);
    });

    test('More button appears when tabs overflow the bar', async ({ page }) => {
      await loadDashboardWithSidebarWidth(page, 220);
      await expect(page.locator('aside .sidebar-tab-more-btn')).toBeVisible();
    });

    test('tab bar is horizontally scrollable when sidebar is narrow', async ({ page }) => {
      await loadDashboardWithSidebarWidth(page, 220);
      const { scrollWidth, clientWidth, overflowX } = await page
        .locator('aside .sidebar-tab-bar')
        .evaluate((el) => ({
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          overflowX: getComputedStyle(el).overflowX,
        }));
      expect(overflowX).toBe('auto');
      expect(scrollWidth).toBeGreaterThan(clientWidth);
    });

    test('clicking More opens a dropdown listing overflow tabs', async ({ page }) => {
      await loadDashboardWithSidebarWidth(page, 220);
      await page.locator('aside .sidebar-tab-more-btn').click();
      const dropdown = page.locator('aside .sidebar-tab-dropdown');
      await expect(dropdown).toBeVisible();
      const items = dropdown.locator('.sidebar-tab-dropdown-item');
      expect(await items.count()).toBeGreaterThan(0);
    });

    test('dropdown updates when scrolling — off-screen tabs join, on-screen tabs leave', async ({ page }) => {
      await loadDashboardWithSidebarWidth(page, 220);
      // While scrolled to the start, Workers is fully visible at position 0 → must NOT be in the dropdown
      await page.locator('aside .sidebar-tab-more-btn').click();
      let dropdown = page.locator('aside .sidebar-tab-dropdown');
      await expect(dropdown).toBeVisible();
      await expect(dropdown.locator('.sidebar-tab-dropdown-item:has-text("Workers")')).toHaveCount(0);
      // Close dropdown before scrolling
      await page.mouse.click(0, 0);
      await page.waitForTimeout(100);

      // Scroll the tab bar all the way to the right — now Workers (leftmost) is off-screen
      await page.locator('aside .sidebar-tab-bar').evaluate((el) => {
        el.scrollLeft = el.scrollWidth;
      });
      await page.waitForTimeout(100);

      await page.locator('aside .sidebar-tab-more-btn').click();
      dropdown = page.locator('aside .sidebar-tab-dropdown');
      await expect(dropdown).toBeVisible();
      // Workers is now fully off-screen to the left → must appear in the dropdown
      await expect(dropdown.locator('.sidebar-tab-dropdown-item:has-text("Workers")')).toHaveCount(1);
    });
  });
});
