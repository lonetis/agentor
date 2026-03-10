import { test, expect } from '@playwright/test';
import { goToDashboard, selectSidebarTab, expectSidebarTabExists } from '../helpers/ui-helpers';

test.describe('Dashboard Page', () => {
  test('loads the dashboard', async ({ page }) => {
    await goToDashboard(page);
    await expect(page.locator('h1:has-text("Agentor")')).toBeVisible();
  });

  test('shows the Orchestrator subtitle', async ({ page }) => {
    await goToDashboard(page);
    // The subtitle is shown as lowercase "Orchestrator" in a smaller font
    await expect(page.locator('p:has-text("Orchestrator")')).toBeVisible();
  });

  test('has the page title set', async ({ page }) => {
    await goToDashboard(page);
    await expect(page).toHaveTitle(/Agentor/);
  });

  test('shows the + New Worker button', async ({ page }) => {
    await goToDashboard(page);
    await expect(page.locator('button:has-text("New Worker")')).toBeVisible();
  });

  test('shows the Environments button', async ({ page }) => {
    await goToDashboard(page);
    await expect(page.locator('button:has-text("Environments")')).toBeVisible();
  });

  test('shows the Workers tab in sidebar', async ({ page }) => {
    await goToDashboard(page);
    await expectSidebarTabExists(page, 'Workers');
  });

  test('shows placeholder in main content area', async ({ page }) => {
    await goToDashboard(page);
    await expect(page.locator('text=Create a worker from the sidebar')).toBeVisible();
  });

  test('shows Ports tab in sidebar', async ({ page }) => {
    await goToDashboard(page);
    await expectSidebarTabExists(page, 'Ports');
  });

  test('shows System tab in sidebar', async ({ page }) => {
    await goToDashboard(page);
    await expectSidebarTabExists(page, 'System');
  });

  test('shows image names in System tab', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'System');
    const aside = page.locator('aside');
    // In dev mode, orchestrator/mapper/worker may be null and not rendered.
    // traefik is always pulled from Docker Hub and should always be present.
    await expect(aside.getByText('traefik', { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test('sidebar shows tab labels', async ({ page }) => {
    await goToDashboard(page);
    await expectSidebarTabExists(page, 'Workers');
    await expectSidebarTabExists(page, 'Usage');
    await expectSidebarTabExists(page, 'System');
  });
});
