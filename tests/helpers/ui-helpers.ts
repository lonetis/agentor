import { Page, Locator, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

/**
 * Find an icon-only button inside a card by hovering each button and matching
 * the Reka UI tooltip text that appears on hover. Returns the button Locator.
 *
 * Uses page.mouse.move (more reliable than locator.hover with Reka UI tooltips
 * per the project's gotcha note). Iterates from the last button backwards
 * because action buttons (Stop/Restart/Archive/Remove) are at the end.
 *
 * The dockerized test runner is slower than the host — bumped tooltip timeout
 * to 5s, and explicitly waits for the previous tooltip to disappear before
 * hovering the next button so we never read stale tooltip text.
 */
export async function findButtonByTooltip(
  card: Locator,
  page: Page,
  tooltipText: string,
): Promise<Locator> {
  const buttons = card.locator('button');
  const count = await buttons.count();
  for (let i = count - 1; i >= 0; i--) {
    const btn = buttons.nth(i);
    await btn.scrollIntoViewIfNeeded();
    const box = await btn.boundingBox();
    if (!box) continue;
    await page.mouse.move(0, 0);
    await page.locator('[role="tooltip"]').first().waitFor({ state: 'hidden', timeout: 2000 }).catch(() => {});
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    try {
      const tooltip = page.locator('[role="tooltip"]');
      await tooltip.first().waitFor({ state: 'visible', timeout: 5000 });
      const text = await tooltip.first().textContent();
      if (text?.trim() === tooltipText) return btn;
    } catch {
      // tooltip didn't appear in time, try next button
    }
  }
  throw new Error(`No button with tooltip "${tooltipText}" found in card`);
}

/**
 * Check whether a button with the given tooltip text exists in the card.
 */
export async function hasButtonWithTooltip(
  card: Locator,
  page: Page,
  tooltipText: string,
): Promise<boolean> {
  try {
    await findButtonByTooltip(card, page, tooltipText);
    return true;
  } catch {
    return false;
  }
}

/**
 * Navigate to the dashboard and wait for it to fully load.
 *
 * Retries on `NETWORK_CHANGED` — chromium can spuriously throw this on
 * inner-DinD when a netlink event arrives mid-navigation. Real network
 * problems still surface (after the retry budget is exhausted).
 */
export async function goToDashboard(page: Page): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      lastErr = undefined;
      break;
    } catch (e) {
      lastErr = e;
      if (!String(e).includes('NETWORK_CHANGED')) throw e;
    }
  }
  if (lastErr) throw lastErr;
  // Wait for the sidebar to render
  await page.waitForSelector('text=Agentor', { timeout: 15_000 });
}

/**
 * Click the "+ New Worker" button to open the create modal.
 */
export async function openCreateWorkerModal(page: Page): Promise<void> {
  await page.click('button:has-text("+ New Worker")');
  // Wait for the modal to appear
  await page.waitForSelector('[role="dialog"]', { timeout: 10_000 });
}

/**
 * Create a worker via the UI modal and wait for it to appear in the sidebar.
 * Returns the generated name.
 */
export async function createWorkerViaUI(page: Page, options?: { displayName?: string }): Promise<string> {
  await openCreateWorkerModal(page);

  // The name input should have a pre-generated name
  const nameInput = page.locator('[role="dialog"] input[placeholder*="name"], [role="dialog"] input').first();

  if (options?.displayName) {
    const displayNameInput = page.locator('[role="dialog"] input').nth(1);
    await displayNameInput.fill(options.displayName);
  }

  // Get the name value before submitting
  const name = await nameInput.inputValue();

  // Click create button
  await page.click('[role="dialog"] button:has-text("Create")');

  // Wait for the modal to close
  await expect(page.locator('[role="dialog"]')).toBeHidden({ timeout: 10_000 });

  return name;
}

/**
 * Wait for a container card to appear in the sidebar with the given status.
 */
export async function waitForContainerStatus(
  page: Page,
  nameOrDisplay: string,
  status: string,
  timeoutMs = 90_000,
): Promise<void> {
  // Wait for the status badge to appear within the container card
  await page.waitForFunction(
    ({ name, expectedStatus }) => {
      const cards = document.querySelectorAll('.rounded-lg');
      for (const card of cards) {
        const nameEl = card.querySelector('h3');
        const badge = card.querySelector('[class*="badge"], span');
        if (nameEl && nameEl.textContent?.includes(name)) {
          // Check for status text in any child
          const allText = card.textContent || '';
          if (allText.toLowerCase().includes(expectedStatus.toLowerCase())) return true;
        }
      }
      return false;
    },
    { name: nameOrDisplay, expectedStatus: status },
    { timeout: timeoutMs },
  );
}

/**
 * Click the "Environments" button in the sidebar to open the environments modal.
 */
export async function openEnvironmentsModal(page: Page): Promise<void> {
  await page.click('button:has-text("Environments")');
  await page.waitForSelector('[role="dialog"]', { timeout: 10_000 });
}

/**
 * Click a sidebar tab by its label to switch to that section.
 * Tab labels: Workers, Archived, Ports, Domains, Usage, System
 *
 * Handles overflow: if the tab is in the "More" dropdown (not inline),
 * clicks the More button first to reveal the dropdown, then clicks the tab.
 */
export async function selectSidebarTab(page: Page, tabLabel: string): Promise<void> {
  // First try inline tabs
  const inlineTab = page.locator('aside .sidebar-tab-bar > .sidebar-tab').filter({ hasText: tabLabel });
  if (await inlineTab.first().isVisible({ timeout: 3_000 }).catch(() => false)) {
    await inlineTab.first().click();
    await page.waitForTimeout(200);
    return;
  }
  // Tab might be in the overflow dropdown — click the "More" button
  const moreBtn = page.locator('aside .sidebar-tab-more-btn');
  if (await moreBtn.isVisible().catch(() => false)) {
    await moreBtn.click();
    const dropdownItem = page.locator('aside .sidebar-tab-dropdown-item').filter({ hasText: tabLabel });
    await expect(dropdownItem.first()).toBeVisible({ timeout: 3_000 });
    await dropdownItem.first().click();
    await page.waitForTimeout(200);
    return;
  }
  // Fallback: try the broader selector
  const tab = page.locator('aside .sidebar-tab').filter({ hasText: tabLabel });
  await expect(tab.first()).toBeVisible({ timeout: 5_000 });
  await tab.first().click();
  await page.waitForTimeout(200);
}

/**
 * Assert that a sidebar tab with the given label exists (inline or in overflow dropdown).
 */
export async function expectSidebarTabExists(page: Page, tabLabel: string): Promise<void> {
  // Check inline tabs first (visible in the tab bar)
  const inlineTab = page.locator('aside .sidebar-tab-bar > .sidebar-tab .sidebar-tab-label').filter({ hasText: tabLabel });
  if (await inlineTab.first().isVisible({ timeout: 2_000 }).catch(() => false)) {
    return; // Tab found inline
  }
  // Check overflow dropdown — open it and look
  const moreBtn = page.locator('aside .sidebar-tab-more-btn');
  if (await moreBtn.isVisible().catch(() => false)) {
    await moreBtn.click();
    const dropdownItem = page.locator('aside .sidebar-tab-dropdown-item').filter({ hasText: tabLabel });
    await expect(dropdownItem.first()).toBeVisible({ timeout: 3_000 });
    // Close dropdown by clicking outside
    await page.mouse.click(0, 0);
    await page.waitForTimeout(200);
    return;
  }
  // Fallback — just assert
  const tab = page.locator('aside .sidebar-tab').filter({ hasText: tabLabel });
  await expect(tab.first()).toBeVisible({ timeout: 5_000 });
}

/**
 * @deprecated Sidebar sections are now tabs — use selectSidebarTab instead.
 */
export async function toggleSidebarSection(page: Page, sectionName: string): Promise<void> {
  await selectSidebarTab(page, sectionName);
}

/**
 * Click the collapse sidebar button.
 */
export async function collapseSidebar(page: Page): Promise<void> {
  await page.click('button[title="Collapse sidebar"]');
  await page.waitForTimeout(300);
}

/**
 * Click the expand sidebar button.
 */
export async function expandSidebar(page: Page): Promise<void> {
  await page.click('button[title="Expand sidebar"]');
  await page.waitForTimeout(300);
}

/**
 * Get the visible containers from the sidebar.
 */
export async function getVisibleContainers(page: Page): Promise<string[]> {
  const cards = page.locator('.rounded-lg h3');
  const names: string[] = [];
  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    const text = await cards.nth(i).textContent();
    if (text) names.push(text.trim());
  }
  return names;
}

/**
 * Accept a browser confirm dialog.
 */
export function acceptNextConfirm(page: Page): void {
  page.once('dialog', dialog => dialog.accept());
}

/**
 * Dismiss a browser confirm dialog.
 */
export function dismissNextConfirm(page: Page): void {
  page.once('dialog', dialog => dialog.dismiss());
}
