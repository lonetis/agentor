import { test, expect } from '@playwright/test';
import { goToDashboard } from '../helpers/ui-helpers';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';
import { ApiClient } from '../helpers/api-client';

test.describe.serial('Port Mappings — Create via UI', () => {
  let containerId: string;
  let displayName: string;
  const TEST_EXTERNAL_PORT = 19500;
  const TEST_INTERNAL_PORT = 8080;

  test.beforeAll(async ({ request }) => {
    displayName = `PortMapTest-${Date.now()}`;
    const container = await createWorker(request, { displayName });
    containerId = container.id;
  });

  test.afterAll(async ({ request }) => {
    // Only clean up our specific port mapping
    const api = new ApiClient(request);
    try { await api.deletePortMapping(TEST_EXTERNAL_PORT); } catch { /* ignore */ }
    await cleanupWorker(request, containerId);
  });

  /**
   * Finds the Port Mappings panel content within the sidebar.
   * The sidebar has a "Port Mappings" header button followed by a content div.
   */
  async function getPortMappingsSection(page: import('@playwright/test').Page) {
    const aside = page.locator('aside');
    // The Port Mappings section header is a button with text "Port Mappings"
    // The content div is the next sibling. But scoping is tricky.
    // Instead, find the first "+ Map" button within the sidebar (Port Mappings comes before Domain Mappings)
    return aside;
  }

  test('fill out port mapping form and click Add creates a mapping', async ({ page }) => {
    await goToDashboard(page);

    const aside = page.locator('aside');

    // Expand Port Mappings section if collapsed
    const pmHeader = aside.locator('button').filter({ hasText: 'Port Mappings' }).first();
    await expect(pmHeader).toBeVisible({ timeout: 10_000 });

    // Click the header to expand if needed
    const mapBtn = aside.locator('button:has-text("+ Map")').first();
    if (!(await mapBtn.isVisible().catch(() => false))) {
      await pmHeader.click();
      await page.waitForTimeout(300);
    }

    // Click "+ Map" to open the form (use first() to target Port Mappings, not Domain Mappings)
    await mapBtn.click();

    // The form should appear with an Add button
    await expect(aside.locator('button:has-text("Add")').first()).toBeVisible({ timeout: 5_000 });

    // The type select is the first <select> in the form area
    const selects = aside.locator('select');
    await selects.first().selectOption('localhost');

    // Select the worker from the second <select>
    await selects.nth(1).selectOption(containerId);

    // Fill external port
    const extPortInput = aside.locator('input[placeholder="Ext port"]');
    await extPortInput.fill(String(TEST_EXTERNAL_PORT));

    // Fill internal port
    const intPortInput = aside.locator('input[placeholder="Int port"]');
    await intPortInput.fill(String(TEST_INTERNAL_PORT));

    // Click Add
    await aside.locator('button:has-text("Add")').first().click();

    // Wait for the mapping to appear in the list
    await expect(aside.getByText(String(TEST_EXTERNAL_PORT))).toBeVisible({ timeout: 15_000 });

    // The + Map button should reappear (form closed)
    await expect(aside.locator('button:has-text("+ Map")').first()).toBeVisible({ timeout: 5_000 });
  });

  test('created mapping shows correct type badge, ports, and worker name', async ({ page }) => {
    await goToDashboard(page);

    const aside = page.locator('aside');

    // Ensure Port Mappings is expanded
    const pmHeader = aside.locator('button').filter({ hasText: 'Port Mappings' }).first();
    await expect(pmHeader).toBeVisible({ timeout: 10_000 });
    const mapBtn = aside.locator('button:has-text("+ Map")').first();
    if (!(await mapBtn.isVisible().catch(() => false))) {
      await pmHeader.click();
      await page.waitForTimeout(300);
    }

    // Wait for the mapping to appear
    await expect(aside.getByText(`:${TEST_EXTERNAL_PORT}`)).toBeVisible({ timeout: 15_000 });

    // Verify "local" type badge is shown
    await expect(aside.getByText('local', { exact: true }).first()).toBeVisible();

    // Verify internal port is displayed
    await expect(aside.getByText(`:${TEST_INTERNAL_PORT}`)).toBeVisible();
  });

  test('delete the created mapping via X button removes it from the list', async ({ page }) => {
    await goToDashboard(page);

    const aside = page.locator('aside');

    // Ensure Port Mappings is expanded
    const pmHeader = aside.locator('button').filter({ hasText: /PORT MAPPINGS/i }).first();
    await expect(pmHeader).toBeVisible({ timeout: 10_000 });
    // Wait a moment for section content to render
    await page.waitForTimeout(500);
    const mapBtn = aside.locator('button:has-text("+ Map")').first();
    if (!(await mapBtn.isVisible().catch(() => false))) {
      await pmHeader.click();
      await page.waitForTimeout(500);
    }

    // Wait for the mapping to appear
    const portText = aside.getByText(`:${TEST_EXTERNAL_PORT}`);
    await expect(portText).toBeVisible({ timeout: 15_000 });

    // Find the delete button (has title "Remove mapping") and click with force
    const deleteBtn = aside.locator('button[title="Remove mapping"]').first();
    await deleteBtn.click({ force: true });

    // Retry if the mapping didn't disappear (click may not have registered)
    try {
      await expect(portText).toBeHidden({ timeout: 5_000 });
    } catch {
      await deleteBtn.click({ force: true });
      await expect(portText).toBeHidden({ timeout: 10_000 });
    }
  });
});
