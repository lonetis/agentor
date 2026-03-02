import { test, expect } from '@playwright/test';
import { goToDashboard } from '../helpers/ui-helpers';

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

  test('shows the Workers section header in sidebar', async ({ page }) => {
    await goToDashboard(page);
    // "Workers" is a paragraph with uppercase styling — use exact match to avoid matching "No workers yet"
    await expect(page.locator('aside').getByText('Workers', { exact: true })).toBeVisible();
  });

  test('shows placeholder in main content area', async ({ page }) => {
    await goToDashboard(page);
    await expect(page.locator('text=Create a worker from the sidebar')).toBeVisible();
  });

  test('shows Port Mappings section', async ({ page }) => {
    await goToDashboard(page);
    await expect(page.locator('button:has-text("Port Mappings")')).toBeVisible();
  });

  test('shows Images section', async ({ page }) => {
    await goToDashboard(page);
    await expect(page.locator('button:has-text("Images")')).toBeVisible();
  });

  test('shows image names in Images section', async ({ page }) => {
    await goToDashboard(page);
    // Should show orchestrator, mapper, worker, traefik (exact match to avoid "Orchestrator" subtitle)
    const aside = page.locator('aside');
    await expect(aside.getByText('orchestrator', { exact: true })).toBeVisible();
    await expect(aside.getByText('worker', { exact: true })).toBeVisible();
  });

  test('sidebar shows Workers label in uppercase', async ({ page }) => {
    await goToDashboard(page);
    const aside = page.locator('aside');
    const workersLabel = aside.getByText('Workers', { exact: true });
    await expect(workersLabel).toBeVisible();
  });
});
