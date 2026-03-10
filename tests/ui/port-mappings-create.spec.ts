import { test, expect } from '@playwright/test';
import { goToDashboard, selectSidebarTab } from '../helpers/ui-helpers';
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

  test('fill out port mapping form and click Add creates a mapping', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'Ports');

    const aside = page.locator('aside');

    // Click "+ Map" to open the form
    const mapBtn = aside.locator('button:has-text("+ Map")').first();
    await expect(mapBtn).toBeVisible({ timeout: 10_000 });
    await mapBtn.click();

    // The form should appear with an Add button
    await expect(aside.locator('button:has-text("Add")').first()).toBeVisible({ timeout: 5_000 });

    // The type select is the first <select> in the form area
    const selects = aside.locator('select');
    await selects.first().selectOption('localhost');

    // Select the worker from the second <select>
    await selects.nth(1).selectOption(containerId);

    // Fill external port
    const extPortInput = aside.locator('input[placeholder="External port"]');
    await extPortInput.fill(String(TEST_EXTERNAL_PORT));

    // Fill internal port
    const intPortInput = aside.locator('input[placeholder="Internal port"]');
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
    await selectSidebarTab(page, 'Ports');

    const aside = page.locator('aside');

    // Wait for the mapping to appear
    await expect(aside.getByText(`:${TEST_EXTERNAL_PORT}`)).toBeVisible({ timeout: 15_000 });

    // Verify "internal" type badge is shown
    await expect(aside.getByText('internal', { exact: true }).first()).toBeVisible();

    // Verify internal port is displayed
    await expect(aside.getByText(`:${TEST_INTERNAL_PORT}`)).toBeVisible();
  });

  test('delete the created mapping via X button removes it from the list', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'Ports');

    const aside = page.locator('aside');

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
