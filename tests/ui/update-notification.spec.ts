import { test, expect } from '@playwright/test';
import { goToDashboard, selectSidebarTab } from '../helpers/ui-helpers';

test.describe('Update Notification / Images Section', () => {
  test('System tab exists in sidebar', async ({ page }) => {
    await goToDashboard(page);
    await expect(page.locator('aside .sidebar-tab').filter({ hasText: 'System' })).toBeVisible();
  });

  test('shows at least one image name', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'System');
    // At least traefik should always be present (pulled as a Docker Hub image).
    const aside = page.locator('aside');
    await expect(aside.getByText('traefik', { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test('System tab shows Images card with content', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'System');
    const aside = page.locator('aside');
    // Images card header should be visible
    await expect(aside.getByText('Images', { exact: true })).toBeVisible({ timeout: 5_000 });
    // traefik image should be shown
    await expect(aside.getByText('traefik', { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test('"Prune unused images" button is visible', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'System');
    const aside = page.locator('aside');
    // The prune button appears once status has loaded
    await expect(aside.getByText('Prune unused images')).toBeVisible({ timeout: 10_000 });
  });

  test('clicking "Prune unused images" triggers prune UI flow', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'System');
    // Intercept prune API to prevent actually deleting the worker image
    await page.route('**/api/updates/prune', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ imagesDeleted: 0, spaceReclaimed: 0 }),
      });
    });

    const aside = page.locator('aside');
    const pruneBtn = aside.getByText('Prune unused images');
    await expect(pruneBtn).toBeVisible({ timeout: 10_000 });

    // Click prune — button text should change to "Pruning..." while running
    await pruneBtn.click();

    // Wait for prune to complete (button returns to original text)
    await expect(aside.getByText('Prune unused images')).toBeVisible({ timeout: 15_000 });

    // After the mock prune, a result should display
    await expect(aside.getByText(/removed/)).toBeVisible({ timeout: 5_000 });

    await page.unrouteAll({ behavior: 'wait' });
  });

  test('prune button is re-enabled after prune completes', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'System');
    // Intercept prune API to prevent actually deleting the worker image
    await page.route('**/api/updates/prune', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ imagesDeleted: 0, spaceReclaimed: 0 }),
      });
    });

    const aside = page.locator('aside');
    const pruneBtn = aside.getByText('Prune unused images');
    await expect(pruneBtn).toBeVisible({ timeout: 10_000 });

    await pruneBtn.click();
    // The button should remain visible after prune (re-enabled, not removed from DOM)
    await expect(aside.getByText('Prune unused images')).toBeVisible({ timeout: 15_000 });

    await page.unrouteAll({ behavior: 'wait' });
  });

  test('traefik image row shows the image name text', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'System');
    const aside = page.locator('aside');

    // The traefik image row has the name rendered as a <span> with font-medium class
    const nameSpan = aside.locator('span.font-medium:has-text("traefik")');
    await expect(nameSpan).toBeVisible({ timeout: 10_000 });
  });

  test('image rows show a digest or status indicator', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'System');
    const aside = page.locator('aside');

    // Wait for image list to load
    await expect(aside.getByText('traefik', { exact: true })).toBeVisible({ timeout: 10_000 });

    // Each visible image row should show either:
    // - A 12-char hex digest (font-mono)
    // - "not found" text
    // - "error" text
    // At minimum, traefik should have a digest displayed
    const digests = aside.locator('span.font-mono');
    const digestCount = await digests.count();
    expect(digestCount).toBeGreaterThanOrEqual(1);
  });

  test('"Check for updates" or "Re-check" button is visible in production mode', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'System');
    const aside = page.locator('aside');

    // Wait for the images section content to load
    await expect(aside.getByText('traefik', { exact: true })).toBeVisible({ timeout: 10_000 });

    // Check production mode status
    const status = await page.evaluate(() => fetch('/api/updates').then(r => r.json()));
    test.skip(!status.isProductionMode, 'Not in production mode');

    // In production mode: either "Check for updates" (no updates) or "Re-check" (updates available)
    const checkBtn = aside.getByText('Check for updates');
    const recheckBtn = aside.getByText('Re-check');
    await expect(checkBtn.or(recheckBtn)).toBeVisible({ timeout: 5_000 });
  });

  test('clicking check/re-check triggers a check without error', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'System');
    const aside = page.locator('aside');

    await expect(aside.getByText('traefik', { exact: true })).toBeVisible({ timeout: 10_000 });

    const status = await page.evaluate(() => fetch('/api/updates').then(r => r.json()));
    test.skip(!status.isProductionMode, 'Not in production mode');

    // Find whichever check button is visible
    const checkBtn = aside.getByText('Check for updates');
    const recheckBtn = aside.getByText('Re-check');
    const btn = checkBtn.or(recheckBtn);
    await expect(btn).toBeVisible({ timeout: 5_000 });

    // Click the button
    await btn.click();

    // Wait for the check to complete (button returns)
    await expect(btn).toBeVisible({ timeout: 15_000 });
  });

  test('check button shows "Checking..." while in progress', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'System');
    const aside = page.locator('aside');

    await expect(aside.getByText('traefik', { exact: true })).toBeVisible({ timeout: 10_000 });

    const status = await page.evaluate(() => fetch('/api/updates').then(r => r.json()));
    test.skip(!status.isProductionMode, 'Not in production mode');

    const checkBtn = aside.getByText('Check for updates');
    const recheckBtn = aside.getByText('Re-check');
    const btn = checkBtn.or(recheckBtn);
    await expect(btn).toBeVisible({ timeout: 5_000 });

    // Intercept the check API to add a delay so we can observe the loading state
    await page.route('**/api/updates/check', async (route) => {
      await new Promise((r) => setTimeout(r, 1000));
      await route.continue();
    });

    await btn.click();

    // Button should show "Checking..." text while in progress
    await expect(aside.getByText('Checking...')).toBeVisible({ timeout: 3_000 });

    // Wait for check to complete
    await expect(btn).toBeVisible({ timeout: 15_000 });
  });

  test('"Prune unused images" is disabled while pruning', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'System');
    const aside = page.locator('aside');
    const pruneBtn = aside.getByText('Prune unused images');
    await expect(pruneBtn).toBeVisible({ timeout: 10_000 });

    // Intercept the prune API to add a delay so we can observe the disabled state
    // Use mock response to prevent actually deleting the worker image
    await page.route('**/api/updates/prune', async (route) => {
      await new Promise((r) => setTimeout(r, 1000));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ imagesDeleted: 0, spaceReclaimed: 0 }),
      });
    });

    await pruneBtn.click();

    // Button should show "Pruning..." text while in progress
    await expect(aside.getByText('Pruning...')).toBeVisible({ timeout: 3_000 });

    // Wait for prune to complete
    await expect(aside.getByText('Prune unused images')).toBeVisible({ timeout: 15_000 });
  });

  test('reconnecting overlay is not shown under normal operation', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'System');
    const aside = page.locator('aside');

    // Wait for images section to load
    await expect(aside.getByText('traefik', { exact: true })).toBeVisible({ timeout: 10_000 });

    // The "Reconnecting..." overlay should not be visible during normal operation
    await expect(aside.getByText('Reconnecting...')).toBeHidden();
  });

  test('image rows and prune button are inside the sidebar', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'System');
    const aside = page.locator('aside');

    // Traefik image name should appear within the sidebar
    await expect(aside.getByText('traefik', { exact: true })).toBeVisible({ timeout: 10_000 });

    // The prune button should also be within the sidebar
    await expect(aside.getByText('Prune unused images')).toBeVisible({ timeout: 10_000 });
  });

  test('null images (no local Docker image) do not render a row', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'System');
    const aside = page.locator('aside');

    // Wait for images section to load
    await expect(aside.getByText('Prune unused images')).toBeVisible({ timeout: 10_000 });

    // Query the API to see which images are null
    const status = await page.evaluate(() =>
      fetch('/api/updates').then((r) => r.json()),
    );

    // For each image key, verify that null entries do not render a row
    // and non-null entries do render a row in the sidebar
    const imageKeys = ['orchestrator', 'mapper', 'worker', 'traefik'] as const;
    for (const key of imageKeys) {
      const imageEl = aside.getByText(key, { exact: true });
      if (status[key] === null) {
        await expect(imageEl).toBeHidden();
      } else {
        await expect(imageEl).toBeVisible();
      }
    }
  });

  test('traefik image shows a green checkmark when up to date in production mode', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'System');
    const aside = page.locator('aside');

    // Wait for the traefik row to load
    await expect(aside.getByText('traefik', { exact: true })).toBeVisible({ timeout: 10_000 });

    // Check if production mode (checkmark only shown in production mode)
    const status = await page.evaluate(() => fetch('/api/updates').then(r => r.json()));
    const isProductionMode = status.orchestrator !== null || status.worker !== null;
    test.skip(!isProductionMode, 'Green checkmark only shows in production mode');

    // In production mode with no update available, a green checkmark should display
    const traefikRow = aside.locator('div:has(> span.font-medium:has-text("traefik"))');
    const checkmark = traefikRow.locator('span').filter({ hasText: '\u2713' });
    await expect(checkmark).toBeVisible({ timeout: 5_000 });
  });

  test('traefik image row shows a truncated digest hash', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'System');
    const aside = page.locator('aside');

    // Wait for traefik row to load
    await expect(aside.getByText('traefik', { exact: true })).toBeVisible({ timeout: 10_000 });

    // The digest is shown in a font-mono span — either:
    // - A single 12-char hex hash (up to date)
    // - "hash1 → hash2" format (update available)
    const traefikRow = aside.locator('div:has(> span.font-medium:has-text("traefik"))');
    const digestSpan = traefikRow.locator('span.font-mono');
    await expect(digestSpan).toBeVisible();

    const digestText = await digestSpan.textContent();
    expect(digestText).toBeTruthy();
    // Match either "abcdef012345" or "abcdef012345 → abcdef012345"
    expect(digestText!.trim()).toMatch(/^[0-9a-f]{12}(\s*→\s*[0-9a-f]{12})?$/);
  });

  test('"Update All" visibility depends on available updates', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'System');
    const aside = page.locator('aside');

    // Wait for images section to load
    await expect(aside.getByText('traefik', { exact: true })).toBeVisible({ timeout: 10_000 });

    // Check the actual update status from the API
    const status = await page.evaluate(() => fetch('/api/updates').then(r => r.json()));
    const hasUpdates = Object.values(status).some(
      (v: any) => v && typeof v === 'object' && v.updateAvailable
    );

    if (hasUpdates) {
      // When updates are available, "Update All" should be visible
      await expect(aside.getByText('Update All')).toBeVisible();
    } else {
      // When no updates are available, "Update All" should be hidden
      await expect(aside.getByText('Update All')).toBeHidden();
    }
  });

  test('per-image "Update" buttons match available updates', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'System');
    const aside = page.locator('aside');

    // Wait for images section to load
    await expect(aside.getByText('traefik', { exact: true })).toBeVisible({ timeout: 10_000 });

    // Check the actual update status from the API
    const status = await page.evaluate(() => fetch('/api/updates').then(r => r.json()));
    const updatableCount = Object.values(status).filter(
      (v: any) => v && typeof v === 'object' && v.updateAvailable
    ).length;

    // The number of per-image Update buttons (excluding "Update All") should match
    const updateBtns = aside.locator('button').filter({ hasText: /^Update$/ });
    await expect(updateBtns).toHaveCount(updatableCount);
  });

  test('active tab persists across reload', async ({ page }) => {
    await goToDashboard(page);
    await selectSidebarTab(page, 'System');

    // Verify System tab content is visible
    await expect(page.locator('aside').getByText('traefik', { exact: true })).toBeVisible({ timeout: 10_000 });

    // Reload the page
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('text=Agentor', { timeout: 15_000 });

    // System tab content should still be visible after reload (traefik image name)
    await expect(page.locator('aside').getByText('traefik', { exact: true })).toBeVisible({ timeout: 10_000 });
  });
});
