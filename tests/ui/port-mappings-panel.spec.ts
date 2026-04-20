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
});
