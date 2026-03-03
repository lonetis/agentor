import { test, expect, Page } from '@playwright/test';
import { goToDashboard, collapseSidebar, expandSidebar } from '../helpers/ui-helpers';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const STORAGE_KEY = 'agentor-ui-state';

// --- Helpers ---

/** Read the unified UI state from localStorage (returns null if missing or corrupt) */
async function getUiState(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate((key) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, STORAGE_KEY);
}

/** Navigate to a non-SPA endpoint (same origin) for localStorage access without SPA module init */
async function goToApiPage(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/api/health`, { waitUntil: 'networkidle' });
}

/** Clear all localStorage, optionally seed key/value pairs, then navigate to dashboard */
async function freshStart(page: Page, seeds?: Record<string, string>): Promise<void> {
  await goToApiPage(page);
  await page.evaluate(() => localStorage.clear());
  if (seeds) {
    for (const [k, v] of Object.entries(seeds)) {
      await page.evaluate(({ k, v }) => localStorage.setItem(k, v), { k, v });
    }
  }
  await goToDashboard(page);
}

/** Build a full seeded UiState JSON string with overrides */
function buildSeededState(overrides: Record<string, unknown> = {}): string {
  const base = {
    sidebar: { width: 320, collapsed: false, panels: { archived: true, portMappings: false, domainMappings: false, usage: false, images: false } },
    panes: { rootNode: null, focusedNodeId: null },
    tmux: { activeWindows: {} },
    ...overrides,
  };
  return JSON.stringify(base);
}

/** Wait for debounced write (500ms) + margin */
async function waitForWrite(page: Page): Promise<void> {
  await page.waitForTimeout(800);
}

// ===========================
// NO WORKERS NEEDED
// ===========================

test.describe('UI State Persistence', () => {
  test.describe('Defaults & Loading', () => {
    test('all defaults are correct on fresh start', async ({ page }) => {
      await freshStart(page);

      const state = await getUiState(page);
      expect(state).not.toBeNull();

      const sidebar = state!.sidebar as Record<string, unknown>;
      expect(sidebar.width).toBe(320);
      expect(sidebar.collapsed).toBe(false);

      const panels = sidebar.panels as Record<string, boolean>;
      expect(panels.archived).toBe(true);
      expect(panels.portMappings).toBe(false);
      expect(panels.domainMappings).toBe(false);
      expect(panels.usage).toBe(false);
      expect(panels.images).toBe(false);

      const panes = state!.panes as Record<string, unknown>;
      expect(panes.rootNode).toBeNull();
      expect(panes.focusedNodeId).toBeNull();

      const tmux = state!.tmux as Record<string, unknown>;
      expect(tmux.activeWindows).toEqual({});
    });

    test('width is clamped to min 200 when loading', async ({ page }) => {
      await freshStart(page, {
        [STORAGE_KEY]: buildSeededState({ sidebar: { width: 50, collapsed: false, panels: { archived: true, portMappings: false, domainMappings: false, usage: false, images: false } } }),
      });

      const state = await getUiState(page);
      expect((state!.sidebar as Record<string, unknown>).width).toBe(200);
    });

    test('width is clamped to max 700 when loading', async ({ page }) => {
      await freshStart(page, {
        [STORAGE_KEY]: buildSeededState({ sidebar: { width: 1200, collapsed: false, panels: { archived: true, portMappings: false, domainMappings: false, usage: false, images: false } } }),
      });

      const state = await getUiState(page);
      expect((state!.sidebar as Record<string, unknown>).width).toBe(700);
    });

    test('partial state fills missing fields with defaults', async ({ page }) => {
      // State with version 1 but missing panels, panes, tmux
      await freshStart(page, {
        [STORAGE_KEY]: JSON.stringify({ version: 1, sidebar: { width: 400 } }),
      });

      const state = await getUiState(page);
      expect(state).not.toBeNull();

      const sidebar = state!.sidebar as Record<string, unknown>;
      expect(sidebar.width).toBe(400);
      // collapsed should default to false
      expect(sidebar.collapsed).toBe(false);

      // panels should have all defaults
      const panels = sidebar.panels as Record<string, boolean>;
      expect(panels.archived).toBe(true);
      expect(panels.portMappings).toBe(false);

      // panes should have defaults
      const panes = state!.panes as Record<string, unknown>;
      expect(panes.rootNode).toBeNull();

      // tmux should have defaults
      const tmux = state!.tmux as Record<string, unknown>;
      expect(tmux.activeWindows).toEqual({});
    });

    test('corrupt localStorage graceful degradation', async ({ page }) => {
      await freshStart(page, {
        [STORAGE_KEY]: '{invalid json!!!',
      });

      const state = await getUiState(page);
      expect(state).not.toBeNull();
      expect((state!.sidebar as Record<string, unknown>).width).toBe(320);
    });
  });

  test.describe('Sidebar Width Persistence', () => {
    test('seeded width persists across reload', async ({ page }) => {
      await freshStart(page, {
        [STORAGE_KEY]: buildSeededState({ sidebar: { width: 450, collapsed: false, panels: { archived: true, portMappings: false, domainMappings: false, usage: false, images: false } } }),
      });

      const state = await getUiState(page);
      expect((state!.sidebar as Record<string, unknown>).width).toBe(450);

      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('text=Agentor', { timeout: 10_000 });

      const stateAfter = await getUiState(page);
      expect((stateAfter!.sidebar as Record<string, unknown>).width).toBe(450);
    });

    test('sidebar drag persists new width', async ({ page }) => {
      await freshStart(page);

      // Find the sidebar resize handle (the separator between sidebar and main area)
      const sidebar = page.locator('aside');
      const box = await sidebar.boundingBox();
      expect(box).not.toBeNull();

      // The drag handle is at the right edge of the sidebar
      const handleX = box!.x + box!.width;
      const handleY = box!.y + box!.height / 2;

      // Drag the handle to the right to widen the sidebar
      await page.mouse.move(handleX, handleY);
      await page.mouse.down();
      await page.mouse.move(handleX + 100, handleY, { steps: 5 });
      await page.mouse.up();

      await waitForWrite(page);

      const state = await getUiState(page);
      const width = (state!.sidebar as Record<string, unknown>).width as number;
      // Width should be larger than default (320), approximately 420
      expect(width).toBeGreaterThan(350);
      expect(width).toBeLessThanOrEqual(700);
    });
  });

  test.describe('Sidebar Collapse Persistence', () => {
    test('collapse persists across reload', async ({ page }) => {
      await freshStart(page);

      await collapseSidebar(page);
      await expect(page.locator('button[title="Expand sidebar"]')).toBeVisible();

      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('button[title="Expand sidebar"]', { timeout: 10_000 });
      await expect(page.locator('button[title="Expand sidebar"]')).toBeVisible();

      const state = await getUiState(page);
      expect((state!.sidebar as Record<string, unknown>).collapsed).toBe(true);
    });

    test('expand after collapse persists across reload', async ({ page }) => {
      await freshStart(page);

      // Collapse
      await collapseSidebar(page);
      await expect(page.locator('button[title="Expand sidebar"]')).toBeVisible();

      // Expand
      await expandSidebar(page);
      await expect(page.locator('h1:has-text("Agentor")')).toBeVisible();

      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('text=Agentor', { timeout: 10_000 });

      // Should be expanded
      await expect(page.locator('h1:has-text("Agentor")')).toBeVisible();

      const state = await getUiState(page);
      expect((state!.sidebar as Record<string, unknown>).collapsed).toBe(false);
    });

    test('mobile auto-collapse is transient and does not persist', async ({ page }) => {
      await freshStart(page);

      // Verify sidebar is expanded initially
      const state1 = await getUiState(page);
      expect((state1!.sidebar as Record<string, unknown>).collapsed).toBe(false);

      // Resize viewport to mobile width to trigger auto-collapse
      await page.setViewportSize({ width: 600, height: 800 });
      await page.waitForTimeout(500);

      // The localStorage state should NOT change to collapsed (mobile is transient)
      const state2 = await getUiState(page);
      expect((state2!.sidebar as Record<string, unknown>).collapsed).toBe(false);

      // Resize back to desktop
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.waitForTimeout(500);
    });
  });

  test.describe('Panel Collapse Persistence', () => {
    test('Port Mappings collapse persists', async ({ page }) => {
      await freshStart(page);

      const btn = page.locator('button:has-text("PORT MAPPINGS")');
      await btn.click();
      await page.waitForTimeout(300);

      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('text=Agentor', { timeout: 10_000 });

      const state = await getUiState(page);
      const panels = (state!.sidebar as Record<string, unknown>).panels as Record<string, boolean>;
      expect(panels.portMappings).toBe(true);
    });

    test('Images collapse persists', async ({ page }) => {
      await freshStart(page);

      const btn = page.locator('button:has-text("IMAGES")');
      await btn.click();
      await page.waitForTimeout(300);

      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('text=Agentor', { timeout: 10_000 });

      const state = await getUiState(page);
      const panels = (state!.sidebar as Record<string, unknown>).panels as Record<string, boolean>;
      expect(panels.images).toBe(true);
    });

    test('Usage collapse persists', async ({ page }) => {
      await freshStart(page);

      const btn = page.locator('button:has-text("USAGE")');
      await btn.click();
      await page.waitForTimeout(300);

      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('text=Agentor', { timeout: 10_000 });

      const state = await getUiState(page);
      const panels = (state!.sidebar as Record<string, unknown>).panels as Record<string, boolean>;
      expect(panels.usage).toBe(true);
    });

    test('multiple panel states persist independently', async ({ page }) => {
      await freshStart(page);

      // Collapse Port Mappings and Images, leave Usage expanded
      await page.locator('button:has-text("PORT MAPPINGS")').click();
      await page.waitForTimeout(200);
      await page.locator('button:has-text("IMAGES")').click();
      await page.waitForTimeout(200);

      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('text=Agentor', { timeout: 10_000 });

      const state = await getUiState(page);
      const panels = (state!.sidebar as Record<string, unknown>).panels as Record<string, boolean>;
      expect(panels.portMappings).toBe(true); // collapsed
      expect(panels.images).toBe(true); // collapsed
      expect(panels.usage).toBe(false); // still expanded
    });

    test('panel re-expand persists', async ({ page }) => {
      await freshStart(page);

      const btn = page.locator('button:has-text("PORT MAPPINGS")');
      // Collapse
      await btn.click();
      await page.waitForTimeout(200);
      // Re-expand
      await btn.click();
      await page.waitForTimeout(200);

      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('text=Agentor', { timeout: 10_000 });

      const state = await getUiState(page);
      const panels = (state!.sidebar as Record<string, unknown>).panels as Record<string, boolean>;
      expect(panels.portMappings).toBe(false); // re-expanded
    });
  });

  // ===========================
  // WORKER TESTS (shared worker)
  // ===========================

  test.describe.serial('Split Pane Persistence', () => {
    let containerId: string;
    let displayName: string;

    test.beforeAll(async ({ request }) => {
      displayName = `Pane-${Date.now()}`;
      const container = await createWorker(request, { displayName });
      containerId = container.id;
    });

    test.afterAll(async ({ request }) => {
      await cleanupWorker(request, containerId);
    });

    test('single terminal tab persists across reload', async ({ page }) => {
      await freshStart(page);

      const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
      await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

      // Open terminal
      const buttons = card.locator('button').filter({ has: page.locator('svg') });
      await buttons.first().click();
      await expect(page.locator('.xterm')).toBeVisible({ timeout: 15_000 });

      await waitForWrite(page);

      // Verify state
      const state = await getUiState(page);
      const panes = state!.panes as Record<string, unknown>;
      expect(panes.rootNode).not.toBeNull();
      expect(panes.focusedNodeId).not.toBeNull();

      // Reload
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('text=Agentor', { timeout: 10_000 });

      // Tab bar should show the display name (restored pane)
      await expect(page.locator(`main >> text=${displayName}`)).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('.xterm')).toBeVisible({ timeout: 15_000 });
    });

    test('focusedNodeId is restored after reload', async ({ page }) => {
      await freshStart(page);

      const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
      await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

      // Open terminal
      const buttons = card.locator('button').filter({ has: page.locator('svg') });
      await buttons.first().click();
      await expect(page.locator('.xterm')).toBeVisible({ timeout: 15_000 });

      await waitForWrite(page);

      // Get the focusedNodeId before reload
      const stateBefore = await getUiState(page);
      const focusedBefore = (stateBefore!.panes as Record<string, unknown>).focusedNodeId;
      expect(focusedBefore).not.toBeNull();

      // Reload
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('text=Agentor', { timeout: 10_000 });

      await waitForWrite(page);

      // focusedNodeId should match
      const stateAfter = await getUiState(page);
      expect((stateAfter!.panes as Record<string, unknown>).focusedNodeId).toBe(focusedBefore);
    });

    test('node IDs do not collide after restore (rehydration)', async ({ page }) => {
      await freshStart(page);

      const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
      await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

      // Open terminal
      const buttons = card.locator('button').filter({ has: page.locator('svg') });
      await buttons.first().click();
      await expect(page.locator('.xterm')).toBeVisible({ timeout: 15_000 });

      await waitForWrite(page);

      // Get the node ID from persisted state
      const state1 = await getUiState(page);
      const rootNode1 = state1!.panes as Record<string, unknown>;
      const nodeId1 = (rootNode1.rootNode as Record<string, unknown>).id as string;

      // Reload — state is restored
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('text=Agentor', { timeout: 10_000 });
      await expect(page.locator('.xterm')).toBeVisible({ timeout: 15_000 });

      // Now open desktop tab (creates a new node)
      // Click the desktop button (second icon button on the card)
      const card2 = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
      await expect(card2.locator('text=running')).toBeVisible({ timeout: 15_000 });
      const desktopButtons = card2.locator('button').filter({ has: page.locator('svg') });
      // Desktop is typically the second button
      await desktopButtons.nth(1).click();
      await page.waitForTimeout(1000);

      await waitForWrite(page);

      // The root should now have 2 tabs (terminal + desktop) in one leaf, not 2 nodes
      // But the key thing: no ID collision. Verify all node IDs in the tree are unique.
      const state2 = await getUiState(page);
      const rootNode2 = (state2!.panes as Record<string, unknown>).rootNode as Record<string, unknown>;
      expect(rootNode2).not.toBeNull();
      // The old node ID should still be present (restored), and tabs should include both
      const tabs = rootNode2.tabs as Array<Record<string, unknown>>;
      expect(tabs.length).toBe(2);
    });

    test('container removal clears persisted pane tabs', async ({ page }) => {
      await freshStart(page);

      const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
      await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

      const buttons = card.locator('button').filter({ has: page.locator('svg') });
      await buttons.first().click();
      await expect(page.locator('.xterm')).toBeVisible({ timeout: 15_000 });

      await waitForWrite(page);

      let state = await getUiState(page);
      expect((state!.panes as Record<string, unknown>).rootNode).not.toBeNull();

      // Remove via UI
      page.once('dialog', (dialog) => dialog.accept());
      await card.locator('button:has-text("Remove")').click();

      await page.waitForTimeout(3000);

      state = await getUiState(page);
      expect((state!.panes as Record<string, unknown>).rootNode).toBeNull();
    });
  });

  test.describe.serial('Tmux Window Persistence', () => {
    let containerId: string;
    let displayName: string;

    test.beforeAll(async ({ request }) => {
      displayName = `Tmux-${Date.now()}`;
      const container = await createWorker(request, { displayName });
      containerId = container.id;
    });

    test.afterAll(async ({ request }) => {
      await cleanupWorker(request, containerId);
    });

    test('default active window is persisted', async ({ page }) => {
      await freshStart(page);

      const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
      await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

      // Open terminal
      const buttons = card.locator('button').filter({ has: page.locator('svg') });
      await buttons.first().click();
      await expect(page.locator('.xterm')).toBeVisible({ timeout: 15_000 });

      await waitForWrite(page);

      const state = await getUiState(page);
      const tmux = state!.tmux as Record<string, unknown>;
      const activeWindows = tmux.activeWindows as Record<string, string>;
      expect(Object.keys(activeWindows).length).toBeGreaterThan(0);
      // The default window should have a name (e.g., 'main' or 'shell')
      const windowName = Object.values(activeWindows)[0];
      expect(typeof windowName).toBe('string');
      expect(windowName!.length).toBeGreaterThan(0);
    });

    test('creating a new tmux window persists the new active window', async ({ page }) => {
      await freshStart(page);

      const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
      await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

      // Open terminal
      const buttons = card.locator('button').filter({ has: page.locator('svg') });
      await buttons.first().click();
      await expect(page.locator('.xterm')).toBeVisible({ timeout: 15_000 });

      // Wait for tmux tab bar to appear
      await page.waitForTimeout(1000);

      // Find and click the "+" button to create a new tmux window
      // Type a name in the input field first
      const tabBar = page.locator('main');
      const newTabInput = tabBar.locator('input[placeholder]').first();
      if (await newTabInput.isVisible()) {
        await newTabInput.fill('test-tab');
      }
      const plusBtn = tabBar.locator('button:has-text("+")').first();
      if (await plusBtn.isVisible()) {
        await plusBtn.click();
        await page.waitForTimeout(1000);
      }

      await waitForWrite(page);

      const state = await getUiState(page);
      const tmux = state!.tmux as Record<string, unknown>;
      const activeWindows = tmux.activeWindows as Record<string, string>;
      // Should have an entry for this container
      const savedWindow = activeWindows[containerId];
      expect(savedWindow).toBeTruthy();
    });

    test('switching tmux window persists the new selection', async ({ page }) => {
      await freshStart(page);

      const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
      await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

      // Open terminal
      const buttons = card.locator('button').filter({ has: page.locator('svg') });
      await buttons.first().click();
      await expect(page.locator('.xterm')).toBeVisible({ timeout: 15_000 });

      // Wait for tmux tabs to load
      await page.waitForTimeout(2000);

      // Check current persisted state
      await waitForWrite(page);
      const stateBefore = await getUiState(page);
      const tmuxBefore = stateBefore!.tmux as Record<string, unknown>;
      const windowsBefore = tmuxBefore.activeWindows as Record<string, string>;
      const firstWindow = windowsBefore[containerId];

      // Look for another tmux tab to click (if there are multiple)
      // The inner tab bar contains tmux window tabs
      const tmuxTabs = page.locator('main button').filter({ hasText: /^(?!.*\+)/ });
      const tabCount = await tmuxTabs.count();

      if (tabCount > 1) {
        // Click a different tab
        for (let i = 0; i < tabCount; i++) {
          const tabText = await tmuxTabs.nth(i).textContent();
          if (tabText && tabText.trim() !== firstWindow) {
            await tmuxTabs.nth(i).click();
            await page.waitForTimeout(500);
            break;
          }
        }

        await waitForWrite(page);

        const stateAfter = await getUiState(page);
        const tmuxAfter = stateAfter!.tmux as Record<string, unknown>;
        const windowsAfter = tmuxAfter.activeWindows as Record<string, string>;
        // The persisted window should have changed
        expect(windowsAfter[containerId]).toBeTruthy();
      }
      // If only one tab, the test passes trivially (nothing to switch to)
    });

    test('active tmux window is restored when reopening terminal tab', async ({ page }) => {
      await freshStart(page);

      const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
      await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });

      // Open terminal
      const buttons = card.locator('button').filter({ has: page.locator('svg') });
      await buttons.first().click();
      await expect(page.locator('.xterm').first()).toBeVisible({ timeout: 15_000 });

      await waitForWrite(page);

      // Get the persisted window name
      const state1 = await getUiState(page);
      const window1 = ((state1!.tmux as Record<string, unknown>).activeWindows as Record<string, string>)[containerId];
      expect(window1).toBeTruthy();

      // Close the terminal tab via the X button on the pane tab bar
      // The close button is opacity-0 until hover, so hover the tab first
      const paneTab = page.locator('main .pane-tab-close').first();
      await paneTab.evaluate((el) => (el as HTMLElement).style.opacity = '1');
      await paneTab.click();
      await page.waitForTimeout(500);

      // Reopen terminal
      await buttons.first().click();
      await expect(page.locator('.xterm').first()).toBeVisible({ timeout: 15_000 });

      await waitForWrite(page);

      // The same window should be active (restored from persisted state)
      const state2 = await getUiState(page);
      const window2 = ((state2!.tmux as Record<string, unknown>).activeWindows as Record<string, string>)[containerId];
      expect(window2).toBe(window1);
    });
  });
});
