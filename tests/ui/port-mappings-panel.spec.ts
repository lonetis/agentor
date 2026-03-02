import { test, expect } from '@playwright/test';
import { goToDashboard } from '../helpers/ui-helpers';
import { createWorker, cleanupWorker, cleanupAllPortMappings } from '../helpers/worker-lifecycle';
import { ApiClient } from '../helpers/api-client';

test.describe('Port Mappings Panel', () => {
  test.describe('Without workers', () => {
    test('Port Mappings section is visible', async ({ page }) => {
      await goToDashboard(page);
      await expect(page.locator('text=PORT MAPPINGS')).toBeVisible();
    });

    test('shows + Map button', async ({ page }) => {
      await goToDashboard(page);
      await expect(page.locator('button:has-text("+ Map")')).toBeVisible();
    });

    test('shows no active mappings message', async ({ page }) => {
      await goToDashboard(page);
      await expect(page.locator('text=No active mappings')).toBeVisible();
    });
  });

  test.describe('With a worker', () => {
    let containerId: string;

    test.beforeEach(async ({ request }) => {
      const container = await createWorker(request);
      containerId = container.id;
    });

    test.afterEach(async ({ request }) => {
      await cleanupAllPortMappings(request);
      await cleanupWorker(request, containerId);
    });

    test('shows API-created port mappings', async ({ page, request }) => {
      const api = new ApiClient(request);
      await api.createPortMapping({
        externalPort: 18000,
        type: 'localhost',
        workerId: containerId,
        internalPort: 3000,
      });

      await goToDashboard(page);
      // Wait for the port mapping to appear
      await expect(page.locator('text=18000')).toBeVisible({ timeout: 15_000 });
    });

    test('shows mapping type label', async ({ page, request }) => {
      const api = new ApiClient(request);
      await api.createPortMapping({
        externalPort: 18001,
        type: 'localhost',
        workerId: containerId,
        internalPort: 3000,
      });

      await goToDashboard(page);
      await expect(page.locator('text=18001')).toBeVisible({ timeout: 15_000 });
      // localhost type is rendered as "local" badge
      await expect(page.locator('aside').locator('text=local').first()).toBeVisible();
    });

    test('clicking + Map opens the form', async ({ page }) => {
      await goToDashboard(page);
      const aside = page.locator('aside');
      await aside.locator('button:has-text("+ Map")').click();
      // Form should appear with Add and Cancel buttons
      await expect(aside.locator('button:has-text("Add")')).toBeVisible({ timeout: 5_000 });
      await expect(aside.locator('button:has-text("Cancel")')).toBeVisible();
      // External port input should be visible
      await expect(aside.locator('input[placeholder="Ext port"]')).toBeVisible();
      await expect(aside.locator('input[placeholder="Int port"]')).toBeVisible();
    });

    test('Cancel closes the form', async ({ page }) => {
      await goToDashboard(page);
      const aside = page.locator('aside');
      await aside.locator('button:has-text("+ Map")').click();
      await expect(aside.locator('button:has-text("Cancel")')).toBeVisible({ timeout: 5_000 });
      await aside.locator('button:has-text("Cancel")').click();
      // Form should be hidden, + Map button should reappear
      await expect(aside.locator('button:has-text("+ Map")')).toBeVisible({ timeout: 5_000 });
      await expect(aside.locator('input[placeholder="Ext port"]')).toBeHidden();
    });

    test('form has type selector with local and ext options', async ({ page }) => {
      await goToDashboard(page);
      const aside = page.locator('aside');
      await aside.locator('button:has-text("+ Map")').click();
      // Type selector is the first select in the form
      const typeSelect = aside.locator('select').first();
      await expect(typeSelect).toBeVisible({ timeout: 5_000 });
      // Should have local and ext options
      const options = typeSelect.locator('option');
      await expect(options).toHaveCount(2);
    });

    test('form has worker selector with Worker placeholder', async ({ page }) => {
      await goToDashboard(page);
      const aside = page.locator('aside');
      await aside.locator('button:has-text("+ Map")').click();
      // Worker selector has a disabled "Worker" placeholder
      const workerSelect = aside.locator('select').nth(1);
      await expect(workerSelect).toBeVisible({ timeout: 5_000 });
      await expect(workerSelect.locator('option[disabled]')).toHaveText('Worker');
    });

    test('shows external type badge for ext mapping', async ({ page, request }) => {
      const api = new ApiClient(request);
      await api.createPortMapping({
        externalPort: 18003,
        type: 'external',
        workerId: containerId,
        internalPort: 3000,
      });

      await goToDashboard(page);
      await expect(page.locator('text=18003')).toBeVisible({ timeout: 15_000 });
      // external type is rendered as "ext" badge
      await expect(page.locator('aside').locator('text=ext').first()).toBeVisible();
    });

    test('delete button removes port mapping', async ({ page, request }) => {
      const api = new ApiClient(request);
      await api.createPortMapping({
        externalPort: 18004,
        type: 'localhost',
        workerId: containerId,
        internalPort: 3000,
      });

      await goToDashboard(page);
      await expect(page.locator('text=18004')).toBeVisible({ timeout: 15_000 });

      // Find the mapping row and click its delete button
      const mappingRow = page.locator('aside').locator('text=18004').locator('..');
      await mappingRow.locator('button').first().click();

      // Mapping should disappear
      await expect(page.locator('text=18004')).toBeHidden({ timeout: 10_000 });
    });

    test('shows delete button on port mapping', async ({ page, request }) => {
      const api = new ApiClient(request);
      await api.createPortMapping({
        externalPort: 18002,
        type: 'localhost',
        workerId: containerId,
        internalPort: 3000,
      });

      await goToDashboard(page);
      await expect(page.locator('text=18002')).toBeVisible({ timeout: 15_000 });
      // Each mapping row should have a delete/remove button
      const aside = page.locator('aside');
      // Look for a delete icon button in the port mappings area
      const portMappingArea = aside.locator('text=18002').locator('..');
      const deleteButton = portMappingArea.locator('button').first();
      await expect(deleteButton).toBeVisible();
    });
  });
});
