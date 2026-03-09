import { test, expect, Page } from '@playwright/test';
import { goToDashboard } from '../helpers/ui-helpers';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// --- Helpers ---

/** Navigate to a same-origin page for localStorage access without SPA initialization */
async function goToApiPage(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/api/health`, { waitUntil: 'networkidle' });
}

/** Clear all localStorage and navigate to dashboard for a clean start */
async function freshStart(page: Page): Promise<void> {
  await goToApiPage(page);
  await page.evaluate(() => localStorage.clear());
  await goToDashboard(page);
}

/**
 * Locate the theme toggle container — the flex div wrapping the three icon buttons.
 * Structure: aside > header > flex-row > ThemeToggle (div.flex.items-center.rounded-md) + collapse button
 */
function themeToggleGroup(page: Page): ReturnType<Page['locator']> {
  return page.locator('aside .flex.items-center.rounded-md');
}

/** The three theme buttons in order: Default (monitor), White (sun), Dark (moon) */
function themeButton(page: Page, index: 0 | 1 | 2): ReturnType<Page['locator']> {
  return themeToggleGroup(page).locator('button').nth(index);
}

/** Shorthand accessors for the three theme buttons */
function defaultButton(page: Page) { return themeButton(page, 0); }
function lightButton(page: Page) { return themeButton(page, 1); }
function darkButton(page: Page) { return themeButton(page, 2); }

/** Check the current class list on <html> */
async function getHtmlClass(page: Page): Promise<string> {
  return (await page.locator('html').getAttribute('class')) ?? '';
}

/** Check whether the page is currently in dark mode */
async function isDarkMode(page: Page): Promise<boolean> {
  return (await getHtmlClass(page)).includes('dark');
}

/** Get the value of a CSS custom property on the document root */
async function getCssVar(page: Page, varName: string): Promise<string> {
  return page.evaluate((name) => {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }, varName);
}

/** Read the nuxt-color-mode preference from localStorage */
async function getStoredColorMode(page: Page): Promise<string | null> {
  return page.evaluate(() => localStorage.getItem('nuxt-color-mode'));
}

// ============================================================================

test.describe('Theme Toggle', () => {
  // -------------------------------------------------------------------------
  // 1. Default state
  // -------------------------------------------------------------------------
  test.describe('Default State', () => {
    test('dashboard loads in dark mode by default', async ({ page }) => {
      await freshStart(page);
      const htmlClass = await getHtmlClass(page);
      expect(htmlClass).toContain('dark');
    });

    test('dark mode button is highlighted on initial load', async ({ page }) => {
      await freshStart(page);
      const moon = darkButton(page);
      const classes = await moon.getAttribute('class');
      // Active button has shadow-sm (highlighted state)
      expect(classes).toContain('shadow-sm');
    });

    test('default and light buttons are not highlighted on initial load', async ({ page }) => {
      await freshStart(page);

      const monitorClasses = await defaultButton(page).getAttribute('class');
      const sunClasses = await lightButton(page).getAttribute('class');

      // Inactive buttons should NOT have the shadow-sm highlight
      expect(monitorClasses).not.toContain('shadow-sm');
      expect(sunClasses).not.toContain('shadow-sm');
    });
  });

  // -------------------------------------------------------------------------
  // 2. Button visibility and structure
  // -------------------------------------------------------------------------
  test.describe('Button Visibility', () => {
    test('three theme toggle buttons are visible in sidebar header', async ({ page }) => {
      await freshStart(page);
      const group = themeToggleGroup(page);
      await expect(group).toBeVisible();

      const buttons = group.locator('button');
      expect(await buttons.count()).toBe(3);

      for (let i = 0; i < 3; i++) {
        await expect(buttons.nth(i)).toBeVisible();
      }
    });

    test('each button contains an SVG icon', async ({ page }) => {
      await freshStart(page);
      const buttons = themeToggleGroup(page).locator('button');

      for (let i = 0; i < 3; i++) {
        const svgCount = await buttons.nth(i).locator('svg, span[class*="i-heroicons"]').count();
        expect(svgCount).toBeGreaterThanOrEqual(1);
      }
    });

    test('toggle group has the rounded background container', async ({ page }) => {
      await freshStart(page);
      const group = themeToggleGroup(page);
      const classes = await group.getAttribute('class');
      expect(classes).toContain('rounded-md');
    });
  });

  // -------------------------------------------------------------------------
  // 3. Switching to light mode
  // -------------------------------------------------------------------------
  test.describe('Switch to Light Mode', () => {
    test('clicking sun button removes dark class from html', async ({ page }) => {
      await freshStart(page);
      // Confirm we start in dark
      expect(await isDarkMode(page)).toBe(true);

      await lightButton(page).click();
      await page.waitForTimeout(300);

      expect(await isDarkMode(page)).toBe(false);
    });

    test('clicking sun button highlights it and dims the others', async ({ page }) => {
      await freshStart(page);

      await lightButton(page).click();
      await page.waitForTimeout(300);

      const sunClasses = await lightButton(page).getAttribute('class');
      expect(sunClasses).toContain('shadow-sm');

      const monitorClasses = await defaultButton(page).getAttribute('class');
      const moonClasses = await darkButton(page).getAttribute('class');
      expect(monitorClasses).not.toContain('shadow-sm');
      expect(moonClasses).not.toContain('shadow-sm');
    });

    test('light mode applies light CSS custom properties', async ({ page }) => {
      await freshStart(page);

      await lightButton(page).click();
      await page.waitForTimeout(300);

      // In light mode, --pane-tab-bg should be the light value (#f6f8fa)
      const paneTabBg = await getCssVar(page, '--pane-tab-bg');
      expect(paneTabBg).toBe('#f6f8fa');

      const terminalBg = await getCssVar(page, '--terminal-bg');
      expect(terminalBg).toBe('#ffffff');

      const scrollbarTrack = await getCssVar(page, '--scrollbar-track');
      expect(scrollbarTrack).toBe('#f6f8fa');
    });

    test('sidebar background changes in light mode', async ({ page }) => {
      await freshStart(page);

      await lightButton(page).click();
      await page.waitForTimeout(300);

      // The sidebar uses bg-gray-50 in light mode, bg-gray-900 in dark
      const sidebar = page.locator('aside');
      const bgColor = await sidebar.evaluate((el) =>
        getComputedStyle(el).backgroundColor,
      );
      // bg-gray-50 is a very light color; just verify it's not the dark gray
      // Dark mode bg-gray-900 is approximately rgb(17, 24, 39) or similar
      // Light mode bg-gray-50 is approximately rgb(249, 250, 251)
      expect(bgColor).not.toContain('rgb(17,');
    });
  });

  // -------------------------------------------------------------------------
  // 4. Switching back to dark mode
  // -------------------------------------------------------------------------
  test.describe('Switch Back to Dark Mode', () => {
    test('clicking moon button restores dark class on html', async ({ page }) => {
      await freshStart(page);

      // Switch to light first
      await lightButton(page).click();
      await page.waitForTimeout(300);
      expect(await isDarkMode(page)).toBe(false);

      // Switch back to dark
      await darkButton(page).click();
      await page.waitForTimeout(300);
      expect(await isDarkMode(page)).toBe(true);
    });

    test('dark mode restores dark CSS custom properties', async ({ page }) => {
      await freshStart(page);

      // Go to light
      await lightButton(page).click();
      await page.waitForTimeout(300);

      // Return to dark
      await darkButton(page).click();
      await page.waitForTimeout(300);

      const paneTabBg = await getCssVar(page, '--pane-tab-bg');
      expect(paneTabBg).toBe('#0d1117');

      const terminalBg = await getCssVar(page, '--terminal-bg');
      expect(terminalBg).toBe('#0d1117');

      const scrollbarThumb = await getCssVar(page, '--scrollbar-thumb');
      expect(scrollbarThumb).toBe('#30363d');
    });

    test('moon button is highlighted after switching back', async ({ page }) => {
      await freshStart(page);

      await lightButton(page).click();
      await page.waitForTimeout(300);

      await darkButton(page).click();
      await page.waitForTimeout(300);

      const moonClasses = await darkButton(page).getAttribute('class');
      expect(moonClasses).toContain('shadow-sm');

      const sunClasses = await lightButton(page).getAttribute('class');
      expect(sunClasses).not.toContain('shadow-sm');
    });
  });

  // -------------------------------------------------------------------------
  // 5. Default/System mode
  // -------------------------------------------------------------------------
  test.describe('Default (System) Mode', () => {
    test('clicking monitor button sets preference to system', async ({ page }) => {
      await freshStart(page);

      // Start from dark, click monitor (system/default)
      await defaultButton(page).click();
      await page.waitForTimeout(300);

      const stored = await getStoredColorMode(page);
      expect(stored).toBe('system');
    });

    test('monitor button is highlighted when system mode is active', async ({ page }) => {
      await freshStart(page);

      await defaultButton(page).click();
      await page.waitForTimeout(300);

      const monitorClasses = await defaultButton(page).getAttribute('class');
      expect(monitorClasses).toContain('shadow-sm');

      const sunClasses = await lightButton(page).getAttribute('class');
      const moonClasses = await darkButton(page).getAttribute('class');
      expect(sunClasses).not.toContain('shadow-sm');
      expect(moonClasses).not.toContain('shadow-sm');
    });

    test('system mode respects prefers-color-scheme: dark', async ({ page }) => {
      await freshStart(page);

      // Emulate dark system preference
      await page.emulateMedia({ colorScheme: 'dark' });

      await defaultButton(page).click();
      await page.waitForTimeout(300);

      expect(await isDarkMode(page)).toBe(true);
    });

    test('system mode respects prefers-color-scheme: light', async ({ page }) => {
      await freshStart(page);

      // Emulate light system preference
      await page.emulateMedia({ colorScheme: 'light' });

      await defaultButton(page).click();
      await page.waitForTimeout(300);

      expect(await isDarkMode(page)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Persistence across reload
  // -------------------------------------------------------------------------
  test.describe('Persistence', () => {
    test('light mode persists across reload', async ({ page }) => {
      await freshStart(page);

      await lightButton(page).click();
      await page.waitForTimeout(300);
      expect(await isDarkMode(page)).toBe(false);

      // Reload
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('text=Agentor', { timeout: 15_000 });

      expect(await isDarkMode(page)).toBe(false);

      // The sun button should still be highlighted
      const sunClasses = await lightButton(page).getAttribute('class');
      expect(sunClasses).toContain('shadow-sm');
    });

    test('dark mode persists across reload', async ({ page }) => {
      await freshStart(page);

      // Switch to light, then back to dark explicitly
      await lightButton(page).click();
      await page.waitForTimeout(300);
      await darkButton(page).click();
      await page.waitForTimeout(300);

      expect(await isDarkMode(page)).toBe(true);

      // Reload
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('text=Agentor', { timeout: 15_000 });

      expect(await isDarkMode(page)).toBe(true);

      const moonClasses = await darkButton(page).getAttribute('class');
      expect(moonClasses).toContain('shadow-sm');
    });

    test('system mode persists across reload', async ({ page }) => {
      await freshStart(page);

      await defaultButton(page).click();
      await page.waitForTimeout(300);

      const stored = await getStoredColorMode(page);
      expect(stored).toBe('system');

      // Reload
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('text=Agentor', { timeout: 15_000 });

      const storedAfter = await getStoredColorMode(page);
      expect(storedAfter).toBe('system');

      // Monitor button should still be highlighted
      const monitorClasses = await defaultButton(page).getAttribute('class');
      expect(monitorClasses).toContain('shadow-sm');
    });

    test('localStorage stores the correct preference value', async ({ page }) => {
      await freshStart(page);

      // Check dark
      let stored = await getStoredColorMode(page);
      expect(stored).toBe('dark');

      // Switch to light
      await lightButton(page).click();
      await page.waitForTimeout(300);
      stored = await getStoredColorMode(page);
      expect(stored).toBe('light');

      // Switch to system
      await defaultButton(page).click();
      await page.waitForTimeout(300);
      stored = await getStoredColorMode(page);
      expect(stored).toBe('system');

      // Switch back to dark
      await darkButton(page).click();
      await page.waitForTimeout(300);
      stored = await getStoredColorMode(page);
      expect(stored).toBe('dark');
    });
  });

  // -------------------------------------------------------------------------
  // 7. Rapid switching and edge cases
  // -------------------------------------------------------------------------
  test.describe('Rapid Switching', () => {
    test('rapid cycling through all modes settles correctly', async ({ page }) => {
      await freshStart(page);

      // Cycle: dark -> light -> system -> dark -> light
      await lightButton(page).click();
      await page.waitForTimeout(100);
      await defaultButton(page).click();
      await page.waitForTimeout(100);
      await darkButton(page).click();
      await page.waitForTimeout(100);
      await lightButton(page).click();
      await page.waitForTimeout(300);

      // Should end in light mode
      expect(await isDarkMode(page)).toBe(false);
      const stored = await getStoredColorMode(page);
      expect(stored).toBe('light');

      // Only light button highlighted
      const sunClasses = await lightButton(page).getAttribute('class');
      expect(sunClasses).toContain('shadow-sm');
    });

    test('clicking the already-active button is a no-op', async ({ page }) => {
      await freshStart(page);

      // Dark is already active; click it again
      await darkButton(page).click();
      await page.waitForTimeout(300);

      expect(await isDarkMode(page)).toBe(true);
      const moonClasses = await darkButton(page).getAttribute('class');
      expect(moonClasses).toContain('shadow-sm');
    });
  });

  // -------------------------------------------------------------------------
  // 8. CSS variable integrity across themes
  // -------------------------------------------------------------------------
  test.describe('CSS Variables', () => {
    test('dark mode sets all expected CSS custom properties', async ({ page }) => {
      await freshStart(page);

      // Verify a selection of dark mode CSS custom properties
      expect(await getCssVar(page, '--pane-tab-bg')).toBe('#0d1117');
      expect(await getCssVar(page, '--pane-tab-border')).toBe('#21262d');
      expect(await getCssVar(page, '--pane-tab-active-bg')).toBe('#161b22');
      expect(await getCssVar(page, '--pane-tab-active-accent')).toBe('#58a6ff');
      expect(await getCssVar(page, '--pane-tab-inactive-text')).toBe('#7d8590');
      expect(await getCssVar(page, '--terminal-bg')).toBe('#0d1117');
      expect(await getCssVar(page, '--terminal-bar-bg')).toBe('#161b22');
      expect(await getCssVar(page, '--terminal-bar-border')).toBe('#30363d');
      expect(await getCssVar(page, '--terminal-accent')).toBe('#58a6ff');
      expect(await getCssVar(page, '--terminal-danger')).toBe('#f85149');
      expect(await getCssVar(page, '--scrollbar-track')).toBe('#0d1117');
      expect(await getCssVar(page, '--scrollbar-thumb')).toBe('#30363d');
      expect(await getCssVar(page, '--scrollbar-thumb-hover')).toBe('#484f58');
    });

    test('light mode sets all expected CSS custom properties', async ({ page }) => {
      await freshStart(page);

      await lightButton(page).click();
      await page.waitForTimeout(300);

      expect(await getCssVar(page, '--pane-tab-bg')).toBe('#f6f8fa');
      expect(await getCssVar(page, '--pane-tab-border')).toBe('#d0d7de');
      expect(await getCssVar(page, '--pane-tab-active-bg')).toBe('#ffffff');
      expect(await getCssVar(page, '--pane-tab-active-accent')).toBe('#0969da');
      expect(await getCssVar(page, '--pane-tab-inactive-text')).toBe('#656d76');
      expect(await getCssVar(page, '--terminal-bg')).toBe('#ffffff');
      expect(await getCssVar(page, '--terminal-bar-bg')).toBe('#f6f8fa');
      expect(await getCssVar(page, '--terminal-bar-border')).toBe('#d0d7de');
      expect(await getCssVar(page, '--terminal-accent')).toBe('#0969da');
      expect(await getCssVar(page, '--terminal-danger')).toBe('#cf222e');
      expect(await getCssVar(page, '--scrollbar-track')).toBe('#f6f8fa');
      expect(await getCssVar(page, '--scrollbar-thumb')).toBe('#d0d7de');
      expect(await getCssVar(page, '--scrollbar-thumb-hover')).toBe('#afb8c1');
    });

    test('CSS variables update when toggling between dark and light', async ({ page }) => {
      await freshStart(page);

      // Start in dark
      const darkTermBg = await getCssVar(page, '--terminal-bg');
      expect(darkTermBg).toBe('#0d1117');

      // Switch to light
      await lightButton(page).click();
      await page.waitForTimeout(300);
      const lightTermBg = await getCssVar(page, '--terminal-bg');
      expect(lightTermBg).toBe('#ffffff');

      // Switch back to dark
      await darkButton(page).click();
      await page.waitForTimeout(300);
      const darkTermBgAgain = await getCssVar(page, '--terminal-bg');
      expect(darkTermBgAgain).toBe('#0d1117');
    });
  });

  // -------------------------------------------------------------------------
  // 9. Theme toggle container styling
  // -------------------------------------------------------------------------
  test.describe('Toggle Container Styling', () => {
    test('toggle container has dark background in dark mode', async ({ page }) => {
      await freshStart(page);
      const group = themeToggleGroup(page);
      const classes = await group.getAttribute('class');
      // The container uses bg-gray-200 dark:bg-gray-800
      // In dark mode, the dark variant applies
      expect(classes).toContain('bg-gray-200');
      expect(classes).toContain('dark:bg-gray-800');
    });

    test('active button has white/light background in dark mode', async ({ page }) => {
      await freshStart(page);
      const moon = darkButton(page);
      const classes = await moon.getAttribute('class');
      // Active in dark mode: dark:bg-gray-600 text class
      expect(classes).toContain('dark:bg-gray-600');
    });

    test('active button has white background in light mode', async ({ page }) => {
      await freshStart(page);
      await lightButton(page).click();
      await page.waitForTimeout(300);

      const sun = lightButton(page);
      const classes = await sun.getAttribute('class');
      // Active in light mode: bg-white
      expect(classes).toContain('bg-white');
      expect(classes).toContain('shadow-sm');
    });
  });
});
