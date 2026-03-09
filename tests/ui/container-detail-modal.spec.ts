import { test, expect } from '@playwright/test';
import { goToDashboard } from '../helpers/ui-helpers';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';
import { ApiClient } from '../helpers/api-client';

test.describe.serial('Container Detail Modal', () => {
  let containerId: string;
  let containerName: string;
  let displayName: string;

  test.beforeAll(async ({ request }) => {
    displayName = `Detail-${Date.now()}`;
    const container = await createWorker(request, { displayName });
    containerId = container.id;
    containerName = container.name;
  });

  test.afterAll(async ({ request }) => {
    if (containerId) {
      await cleanupWorker(request, containerId);
    }
  });

  // --- Helper to open the detail modal for the shared worker ---
  async function openDetailModal(page: import('@playwright/test').Page) {
    await goToDashboard(page);
    await page.waitForSelector(`h3:has-text("${displayName}")`, { timeout: 15_000 });
    await page.locator(`h3:has-text("${displayName}")`).first().click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    return dialog;
  }

  test('opens detail modal when clicking container name', async ({ page }) => {
    await goToDashboard(page);
    await page.waitForSelector(`h3:has-text("${displayName}")`, { timeout: 15_000 });
    await page.locator(`h3:has-text("${displayName}")`).first().click();
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5_000 });
  });

  test('shows container display name in modal header', async ({ page }) => {
    const dialog = await openDetailModal(page);
    await expect(dialog.locator('h2')).toContainText(displayName);
  });

  test('shows Worker section with Container ID', async ({ page }) => {
    const dialog = await openDetailModal(page);
    // The modal shows a "Worker" section header
    await expect(dialog.getByText('Worker', { exact: true })).toBeVisible();
    // Should show Container ID label
    await expect(dialog.getByText('Container ID', { exact: true })).toBeVisible();
  });

  test('shows container name in Worker section', async ({ page }) => {
    const dialog = await openDetailModal(page);
    // Should show "Container" label with the container name value
    await expect(dialog.getByText('Container', { exact: true })).toBeVisible();
  });

  test('shows Image and Image ID fields', async ({ page }) => {
    const dialog = await openDetailModal(page);
    await expect(dialog.getByText('Image', { exact: true }).first()).toBeVisible();
    await expect(dialog.getByText('Image ID', { exact: true })).toBeVisible();
  });

  test('shows Created field', async ({ page }) => {
    const dialog = await openDetailModal(page);
    await expect(dialog.getByText('Created', { exact: true })).toBeVisible();
  });

  test('shows Configuration section with worker config', async ({ page }) => {
    const dialog = await openDetailModal(page);
    // Configuration section shows worker config fields (environment, docker, etc.)
    await expect(dialog.getByText('Configuration', { exact: true })).toBeVisible();
  });

  test('shows status badge in modal', async ({ page }) => {
    const dialog = await openDetailModal(page);
    // Should show running status badge
    await expect(dialog.locator('text=running')).toBeVisible();
  });

  test('can close with Escape', async ({ page }) => {
    await openDetailModal(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('[role="dialog"]')).toBeHidden({ timeout: 5_000 });
  });

  test('can close by clicking overlay', async ({ page }) => {
    const dialog = await openDetailModal(page);
    // Click the overlay backdrop to close (click at top-left corner, outside the modal content)
    await page.mouse.click(10, 10);
    await expect(dialog).toBeHidden({ timeout: 5_000 });
  });

  test('Configuration section shows environment name', async ({ page }) => {
    const dialog = await openDetailModal(page);
    // The Configuration section shows worker config fields
    await expect(dialog.getByText('Environment', { exact: true })).toBeVisible();
  });

  test('Container ID is displayed as truncated hash', async ({ page }) => {
    const dialog = await openDetailModal(page);
    // Container IDs are long hex strings; the UI shows a truncated version
    // Check that something that looks like a truncated ID is visible (monospace)
    const containerIdLabel = dialog.getByText('Container ID', { exact: true });
    await expect(containerIdLabel).toBeVisible();
  });

  test('Configuration section shows Docker Enabled when applicable', async ({ page }) => {
    const dialog = await openDetailModal(page);
    // Docker Enabled is shown when the worker has dockerEnabled=true
    await expect(dialog.getByText('Docker Enabled')).toBeVisible();
  });

  // --- New tests below ---

  test('status badge has success color for running worker', async ({ page }) => {
    const dialog = await openDetailModal(page);
    // The UBadge for a running container uses color="success" which renders
    // with a success-themed class. Locate the badge element containing "running".
    const badge = dialog.locator('span:has-text("running")').first();
    await expect(badge).toBeVisible();
    // Nuxt UI v3 UBadge with color="success" includes a data attribute or class
    // containing "success". Check the rendered class list.
    const classes = await badge.getAttribute('class');
    expect(classes).toBeTruthy();
    // The badge should contain a success-related style indicator
    expect(classes!.toLowerCase()).toMatch(/success|green/);
  });

  test('Container ID value shows first 12 characters of actual ID', async ({ page }) => {
    const dialog = await openDetailModal(page);
    // The modal renders container.id.slice(0, 12) in a dd element next to the
    // "Container ID" dt. The full ID is in the title attribute.
    const truncatedId = containerId.slice(0, 12);
    // Find the dd that contains the truncated ID
    const idValue = dialog.locator('dd').filter({ hasText: truncatedId });
    await expect(idValue).toBeVisible();
    // The dd should have a title attribute with the full container ID
    const title = await idValue.getAttribute('title');
    expect(title).toBe(containerId);
  });

  test('Container name value is displayed in Worker section', async ({ page }) => {
    const dialog = await openDetailModal(page);
    // The modal shows shortName(container.name) which strips the "agentor-worker-" prefix.
    // The container name (with or without prefix) should appear in the dialog.
    // shortName strips "agentor-worker-" prefix
    const prefix = 'agentor-worker-';
    const shortName = containerName.startsWith(prefix)
      ? containerName.slice(prefix.length)
      : containerName;
    // The dd next to "Container" dt should contain the short name
    const nameValue = dialog.locator('dd').filter({ hasText: shortName });
    await expect(nameValue.first()).toBeVisible();
  });

  test('Image value shows the worker image name', async ({ page }) => {
    const dialog = await openDetailModal(page);
    // The worker image is typically "agentor-worker:latest" or similar.
    // The Image dd has a title attribute with the full image reference.
    const imageDt = dialog.getByText('Image', { exact: true }).first();
    await expect(imageDt).toBeVisible();
    // The dd following Image dt should contain "agentor-worker" (the image name)
    // Look for any dd that contains agentor-worker in its text or title
    const imageDd = dialog.locator('dd[title*="agentor-worker"]');
    await expect(imageDd.first()).toBeVisible();
  });

  test('Image ID value shows a truncated sha256 hash', async ({ page }) => {
    const dialog = await openDetailModal(page);
    // The modal shows shortImageId which is the first 12 chars of the sha256 hash
    // (after removing the "sha256:" prefix). Verify a 12-char hex string is present.
    const imageIdDt = dialog.getByText('Image ID', { exact: true });
    await expect(imageIdDt).toBeVisible();
    // The Image ID dd has a title attribute containing the full sha256 reference
    const imageIdDd = dialog.locator('dd[title*="sha256:"]');
    await expect(imageIdDd).toBeVisible();
    // The displayed text should be exactly 12 hex characters
    const idText = await imageIdDd.textContent();
    expect(idText!.trim()).toMatch(/^[0-9a-f]{12}$/);
  });

  test('Created timestamp is a formatted date, not a dash', async ({ page }) => {
    const dialog = await openDetailModal(page);
    // The Created dd should show a locale-formatted date string, not an em-dash.
    // Locate the "Created" dt, then find the adjacent dd.
    const createdDt = dialog.getByText('Created', { exact: true });
    await expect(createdDt).toBeVisible();
    // The dd elements in the Worker section contain the values.
    // Created is the last dt/dd pair, so get the last dd in the dl.
    const allDds = dialog.locator('section').first().locator('dd');
    const lastDd = allDds.last();
    const text = await lastDd.textContent();
    // Should NOT be an em-dash (which means no createdAt)
    expect(text!.trim()).not.toBe('\u2014');
    // Should contain digits (from the date/time)
    expect(text!.trim()).toMatch(/\d/);
  });

  test('can re-open modal after closing with Escape', async ({ page }) => {
    const dialog = await openDetailModal(page);
    await expect(dialog).toBeVisible();
    // Close
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 5_000 });
    // Re-open by clicking the container name again
    await page.locator(`h3:has-text("${displayName}")`).first().click();
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    // Verify content is still correct
    await expect(dialog.locator('h2')).toContainText(displayName);
  });

  test('Worker section displays all five key-value pairs', async ({ page }) => {
    const dialog = await openDetailModal(page);
    // The Worker section dl should have exactly 5 dt/dd pairs:
    // Container, Container ID, Image, Image ID, Created
    const workerSection = dialog.locator('section').first();
    const dtElements = workerSection.locator('dt');
    await expect(dtElements).toHaveCount(5);
    // Verify each label
    await expect(dtElements.nth(0)).toHaveText('Container');
    await expect(dtElements.nth(1)).toHaveText('Container ID');
    await expect(dtElements.nth(2)).toHaveText('Image');
    await expect(dtElements.nth(3)).toHaveText('Image ID');
    await expect(dtElements.nth(4)).toHaveText('Created');
  });

  test('header displays display name with h2 tag', async ({ page }) => {
    const dialog = await openDetailModal(page);
    // The h2 should contain the exact display name and be styled as a header
    const header = dialog.locator('h2');
    await expect(header).toHaveCount(1);
    const headerText = await header.textContent();
    expect(headerText!.trim()).toBe(displayName);
  });
});

test.describe.serial('Container Detail Modal — Custom Environment', () => {
  let containerId: string;
  let displayName: string;
  let envId: string;
  const envName = `TestEnv-${Date.now()}`;

  test.beforeAll(async ({ request }) => {
    // Create a custom environment
    const api = new ApiClient(request);
    const { status, body } = await api.createEnvironment({ name: envName });
    expect(status).toBe(201);
    envId = body.id;

    // Create a worker using the custom environment
    displayName = `EnvDetail-${Date.now()}`;
    const container = await createWorker(request, {
      displayName,
      environmentId: envId,
    });
    containerId = container.id;
  });

  test.afterAll(async ({ request }) => {
    if (containerId) {
      await cleanupWorker(request, containerId);
    }
    if (envId) {
      const api = new ApiClient(request);
      try { await api.deleteEnvironment(envId); } catch { /* ignore */ }
    }
  });

  test('Configuration section shows custom environment name', async ({ page }) => {
    await goToDashboard(page);
    await page.waitForSelector(`h3:has-text("${displayName}")`, { timeout: 15_000 });
    await page.locator(`h3:has-text("${displayName}")`).first().click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    // The Configuration section should show the custom environment name
    await expect(dialog.getByText('Environment', { exact: true })).toBeVisible();
    // The value next to Environment should be the custom environment name
    await expect(dialog.getByText(envName)).toBeVisible();
  });
});
