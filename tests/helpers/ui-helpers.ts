import { Page, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

/**
 * Navigate to the dashboard and wait for it to fully load.
 */
export async function goToDashboard(page: Page): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  // Wait for the sidebar to render
  await page.waitForSelector('text=Agentor', { timeout: 15_000 });
}

/**
 * Click the "+ New Worker" button to open the create modal.
 */
export async function openCreateWorkerModal(page: Page): Promise<void> {
  await page.click('button:has-text("+ New Worker")');
  // Wait for the modal to appear
  await page.waitForSelector('[role="dialog"]', { timeout: 5_000 });
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
  await page.waitForSelector('[role="dialog"]', { timeout: 5_000 });
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
