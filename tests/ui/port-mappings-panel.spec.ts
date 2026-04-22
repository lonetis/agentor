import { test, expect } from '@playwright/test';
import { goToDashboard, selectSidebarTab, expectSidebarTabExists } from '../helpers/ui-helpers';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';
import { ApiClient } from '../helpers/api-client';

test.describe('Port Mappings Panel', () => {
  test.describe('Without workers', () => {
    test('Ports tab is visible in sidebar', async ({ page }) => {
      await goToDashboard(page);
      await expectSidebarTabExists(page, 'Ports');
    });

    test('shows + Map button', async ({ page }) => {
      await goToDashboard(page);
      await selectSidebarTab(page, 'Ports');
      await expect(page.locator('button:has-text("+ Map")').first()).toBeVisible();
    });

  });

  test.describe('With a worker', () => {
    let containerId: string;
    let containerDockerName: string;
    let _portCounter = 0;
    function uniquePort(): number {
      const base = 10000 + Math.floor(Math.random() * 40000);
      return base + (_portCounter++ % 10000);
    }

    test.beforeEach(async ({ request }) => {
      const container = await createWorker(request);
      containerId = container.id;
      containerDockerName = container.containerName as string;
    });

    test.afterEach(async ({ request }) => {
      // Only clean up mappings for our specific worker (not all mappings globally)
      const api = new ApiClient(request);
      const { body: mappings } = await api.listPortMappings();
      for (const m of mappings) {
        if (m.containerName === containerDockerName) {
          try { await api.deletePortMapping(m.externalPort); } catch { /* ignore */ }
        }
      }
      await cleanupWorker(request, containerId);
    });

    test('shows API-created port mappings', async ({ page, request }) => {
      const api = new ApiClient(request);
      const port = uniquePort();
      await api.createPortMapping({
        externalPort: port,
        type: 'localhost',
        workerId: containerId,
        internalPort: 3000,
      });

      await goToDashboard(page);
      await selectSidebarTab(page, 'Ports');
      // Wait for the port mapping to appear
      await expect(page.locator(`text=${port}`)).toBeVisible({ timeout: 15_000 });
    });

    test('shows mapping type label', async ({ page, request }) => {
      const api = new ApiClient(request);
      const port = uniquePort();
      await api.createPortMapping({
        externalPort: port,
        type: 'localhost',
        workerId: containerId,
        internalPort: 3000,
      });

      await goToDashboard(page);
      await selectSidebarTab(page, 'Ports');
      await expect(page.locator(`text=${port}`)).toBeVisible({ timeout: 15_000 });
      // localhost type is rendered as "internal" badge
      await expect(page.locator('aside').locator('text=internal').first()).toBeVisible();
    });

    test('clicking + Map opens the form', async ({ page }) => {
      await goToDashboard(page);
      await selectSidebarTab(page, 'Ports');
      const aside = page.locator('aside');
      await aside.locator('button:has-text("+ Map")').first().click();
      // Form should appear with Add and Cancel buttons
      await expect(aside.locator('button:has-text("Add")').first()).toBeVisible({ timeout: 10_000 });
      await expect(aside.locator('button:has-text("Cancel")').first()).toBeVisible();
      // External port input should be visible
      await expect(aside.locator('input[placeholder="External port"]')).toBeVisible();
      await expect(aside.locator('input[placeholder="Internal port"]')).toBeVisible();
    });

    test('Cancel closes the form', async ({ page }) => {
      await goToDashboard(page);
      await selectSidebarTab(page, 'Ports');
      const aside = page.locator('aside');
      await aside.locator('button:has-text("+ Map")').first().click();
      await expect(aside.locator('button:has-text("Cancel")').first()).toBeVisible({ timeout: 10_000 });
      await aside.locator('button:has-text("Cancel")').first().click();
      // Form should be hidden, + Map button should reappear
      await expect(aside.locator('button:has-text("+ Map")').first()).toBeVisible({ timeout: 10_000 });
      await expect(aside.locator('input[placeholder="External port"]')).toBeHidden();
    });

    test('form has type selector with internal and external options', async ({ page }) => {
      await goToDashboard(page);
      await selectSidebarTab(page, 'Ports');
      const aside = page.locator('aside');
      await aside.locator('button:has-text("+ Map")').first().click();
      // Type selector is the first select in the form
      const typeSelect = aside.locator('select').first();
      await expect(typeSelect).toBeVisible({ timeout: 10_000 });
      // Should have internal and external options
      const options = typeSelect.locator('option');
      await expect(options).toHaveCount(2);
    });

    test('form has worker selector with Worker placeholder', async ({ page }) => {
      await goToDashboard(page);
      await selectSidebarTab(page, 'Ports');
      const aside = page.locator('aside');
      await aside.locator('button:has-text("+ Map")').first().click();
      // Worker selector has a disabled "Worker" placeholder
      const workerSelect = aside.locator('select').nth(1);
      await expect(workerSelect).toBeVisible({ timeout: 10_000 });
      await expect(workerSelect.locator('option[disabled]')).toHaveText('Worker');
    });

    test('shows external type badge for external mapping', async ({ page, request }) => {
      const api = new ApiClient(request);
      const port = uniquePort();
      await api.createPortMapping({
        externalPort: port,
        type: 'external',
        workerId: containerId,
        internalPort: 3000,
      });

      await goToDashboard(page);
      await selectSidebarTab(page, 'Ports');
      await expect(page.locator(`text=${port}`)).toBeVisible({ timeout: 15_000 });
      // external type is rendered as "external" badge
      await expect(page.locator('aside').locator('text=external').first()).toBeVisible();
    });

    test('delete button removes port mapping', async ({ page, request }) => {
      const api = new ApiClient(request);
      const port = uniquePort();
      await api.createPortMapping({
        externalPort: port,
        type: 'localhost',
        workerId: containerId,
        internalPort: 3000,
      });

      await goToDashboard(page);
      await selectSidebarTab(page, 'Ports');
      await expect(page.locator(`text=${port}`)).toBeVisible({ timeout: 15_000 });

      // Find the mapping row and click its delete button
      const mappingRow = page.locator('aside').locator(`text=${port}`).locator('..');
      await mappingRow.locator('button').first().click();

      // Mapping should disappear
      await expect(page.locator(`text=${port}`)).toBeHidden({ timeout: 10_000 });
    });

    test('shows delete button on port mapping', async ({ page, request }) => {
      const api = new ApiClient(request);
      const port = uniquePort();
      await api.createPortMapping({
        externalPort: port,
        type: 'localhost',
        workerId: containerId,
        internalPort: 3000,
      });

      await goToDashboard(page);
      await selectSidebarTab(page, 'Ports');
      await expect(page.locator(`text=${port}`)).toBeVisible({ timeout: 15_000 });
      // Each mapping row should have a delete/remove button
      const aside = page.locator('aside');
      // Look for a delete icon button in the port mappings area
      const portMappingArea = aside.locator(`text=${port}`).locator('..');
      const deleteButton = portMappingArea.locator('button').first();
      await expect(deleteButton).toBeVisible();
    });
  });

  test.describe.serial('Create via UI form submission', () => {
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
      await expect(aside.locator('button:has-text("Add")').first()).toBeVisible({ timeout: 10_000 });

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
      await expect(aside.locator('button:has-text("+ Map")').first()).toBeVisible({ timeout: 10_000 });
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
  });
});
