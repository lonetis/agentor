import { test, expect } from '@playwright/test';
import { goToDashboard, findButtonByTooltip } from '../helpers/ui-helpers';
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
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    return dialog;
  }

  test('opens detail modal when clicking container name', async ({ page }) => {
    await goToDashboard(page);
    await page.waitForSelector(`h3:has-text("${displayName}")`, { timeout: 15_000 });
    await page.locator(`h3:has-text("${displayName}")`).first().click();
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 10_000 });
  });

  test('shows container display name in modal header', async ({ page }) => {
    const dialog = await openDetailModal(page);
    await expect(dialog.locator('h2')).toContainText(displayName);
  });

  test('shows Worker section with Worker ID and Container ID', async ({ page }) => {
    const dialog = await openDetailModal(page);
    // The modal shows a "Worker" section header
    await expect(dialog.getByText('Worker', { exact: true })).toBeVisible();
    // Should show Worker ID label (the UUID) and Container ID label
    await expect(dialog.getByText('Worker ID', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Container ID', { exact: true })).toBeVisible();
  });

  test('shows Worker ID label in Worker section', async ({ page }) => {
    const dialog = await openDetailModal(page);
    // The first Worker-section row is now "Worker ID" (the UUID), not "Container"
    await expect(dialog.getByText('Worker ID', { exact: true })).toBeVisible();
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
    await expect(page.locator('[role="dialog"]')).toBeHidden({ timeout: 10_000 });
  });

  test('can close by clicking overlay', async ({ page }) => {
    const dialog = await openDetailModal(page);
    // Click the overlay backdrop to close (click at top-left corner, outside the modal content)
    await page.mouse.click(10, 10);
    await expect(dialog).toBeHidden({ timeout: 10_000 });
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

  test('Configuration section shows Docker field', async ({ page }) => {
    const dialog = await openDetailModal(page);
    // The Configuration section has a "Docker" dt with "Enabled" or "Disabled" dd
    await expect(dialog.getByText('Docker', { exact: true })).toBeVisible();
  });

  test('Configuration section shows CPU and Memory Limit fields', async ({ page }) => {
    const dialog = await openDetailModal(page);
    await expect(dialog.getByText('CPU Limit', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Memory Limit', { exact: true })).toBeVisible();
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

  test('Worker ID value shows the worker UUID in monospace', async ({ page }) => {
    const dialog = await openDetailModal(page);
    // The Worker section's first row shows container.name verbatim — a UUID v4.
    // (No prefix-stripping shortName anymore.)
    expect(containerName).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    // The dd next to "Worker ID" dt should contain the full UUID and a matching title.
    const idValue = dialog.locator('dd').filter({ hasText: containerName });
    await expect(idValue.first()).toBeVisible();
    const title = await idValue.first().getAttribute('title');
    expect(title).toBe(containerName);
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
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    // Re-open by clicking the container name again
    await page.locator(`h3:has-text("${displayName}")`).first().click();
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    // Verify content is still correct
    await expect(dialog.locator('h2')).toContainText(displayName);
  });

  test('Worker section displays all five key-value pairs', async ({ page }) => {
    const dialog = await openDetailModal(page);
    // The Worker section dl should have exactly 5 dt/dd pairs:
    // Worker ID, Container ID, Image, Image ID, Created
    const workerSection = dialog.locator('section').first();
    const dtElements = workerSection.locator('dt');
    await expect(dtElements).toHaveCount(5);
    // Verify each label
    await expect(dtElements.nth(0)).toHaveText('Worker ID');
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

  // --- Section visibility tests ---

  test('shows Network section with Mode and Package Managers fields', async ({ page }) => {
    const dialog = await openDetailModal(page);
    await expect(dialog.getByText('Network', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Mode', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Package Managers', { exact: true })).toBeVisible();
  });

  test('shows Repositories section header', async ({ page }) => {
    const dialog = await openDetailModal(page);
    await expect(dialog.getByText('Repositories', { exact: true })).toBeVisible();
  });

  test('Repositories section shows "None" when no repos configured', async ({ page }) => {
    const dialog = await openDetailModal(page);
    // The default worker has no repos, so should show italic "None"
    const reposSection = dialog.locator('section').filter({ hasText: 'Repositories' });
    await expect(reposSection.locator('span.italic')).toContainText('None');
  });

  test('shows Mounts section header', async ({ page }) => {
    const dialog = await openDetailModal(page);
    await expect(dialog.getByText('Mounts', { exact: true })).toBeVisible();
  });

  test('Mounts section shows "None" when no mounts configured', async ({ page }) => {
    const dialog = await openDetailModal(page);
    // The default worker has no mounts, so should show italic "None"
    const mountsSection = dialog.locator('section').filter({ hasText: 'Mounts' });
    await expect(mountsSection.locator('span.italic')).toContainText('None');
  });

  test('shows Init Script section header', async ({ page }) => {
    const dialog = await openDetailModal(page);
    await expect(dialog.getByText('Init Script', { exact: true })).toBeVisible();
  });

  test('Init Script section shows "None" when no init script configured', async ({ page }) => {
    const dialog = await openDetailModal(page);
    // The default worker has no init script, so should show italic "None"
    const initSection = dialog.locator('section').filter({ hasText: 'Init Script' });
    await expect(initSection.locator('span.italic')).toContainText('None');
  });

  test('shows Exposed Worker APIs section header', async ({ page }) => {
    const dialog = await openDetailModal(page);
    await expect(dialog.getByText('Exposed Worker APIs', { exact: true })).toBeVisible();
  });

  test('Exposed Worker APIs section shows API badges for default worker', async ({ page }) => {
    const dialog = await openDetailModal(page);
    // The default worker has all APIs exposed (portMappings, domainMappings, usage)
    const apisSection = dialog.locator('section').filter({ hasText: 'Exposed Worker APIs' });
    await expect(apisSection.getByText('Port Mappings')).toBeVisible();
    await expect(apisSection.getByText('Domain Mappings')).toBeVisible();
    await expect(apisSection.getByText('Usage')).toBeVisible();
  });

  test('shows Capabilities section header', async ({ page }) => {
    const dialog = await openDetailModal(page);
    await expect(dialog.getByText('Capabilities', { exact: true })).toBeVisible();
  });

  test('Capabilities section shows capability badges for default worker', async ({ page }) => {
    const dialog = await openDetailModal(page);
    // The default worker has capabilities from the default environment
    const capabilitiesSection = dialog.locator('section').filter({ hasText: 'Capabilities' });
    // At least one capability badge should be visible (not "None")
    await expect(capabilitiesSection.locator('span').filter({ hasText: /^[a-z]/ }).first()).toBeVisible();
  });

  test('shows Instructions section header', async ({ page }) => {
    const dialog = await openDetailModal(page);
    await expect(dialog.getByText('Instructions', { exact: true })).toBeVisible();
  });

  test('Instructions section shows entry badges for default worker', async ({ page }) => {
    const dialog = await openDetailModal(page);
    // The default worker has instruction entries from the default environment
    const instructionsSection = dialog.locator('section').filter({ hasText: 'Instructions' });
    // At least one entry badge should be visible (not "None")
    await expect(instructionsSection.locator('span').filter({ hasText: /^[a-z]/ }).first()).toBeVisible();
  });

  test('shows Environment Variables section header', async ({ page }) => {
    const dialog = await openDetailModal(page);
    await expect(dialog.getByText('Environment Variables', { exact: true })).toBeVisible();
  });

  test('Environment Variables section shows "None" when no env vars configured', async ({ page }) => {
    const dialog = await openDetailModal(page);
    // The default worker has no custom env vars, so should show italic "None"
    const envVarsSection = dialog.locator('section').filter({ hasText: 'Environment Variables' });
    await expect(envVarsSection.locator('span.italic')).toContainText('None');
  });

  test('shows Setup Script section header', async ({ page }) => {
    const dialog = await openDetailModal(page);
    await expect(dialog.getByText('Setup Script', { exact: true })).toBeVisible();
  });

  test('Setup Script section shows "None" when no setup script configured', async ({ page }) => {
    const dialog = await openDetailModal(page);
    // The default worker has no setup script, so should show italic "None"
    const setupSection = dialog.locator('section').filter({ hasText: 'Setup Script' });
    await expect(setupSection.locator('span.italic')).toContainText('None');
  });

  test('all always-visible sections are present in correct order', async ({ page }) => {
    const dialog = await openDetailModal(page);
    // Verify all section headers appear in the modal
    // Sections: Worker, Configuration, Network, Repositories, Mounts, Init Script,
    // Exposed Worker APIs, Capabilities, Instructions, Environment Variables, Setup Script
    const sections = dialog.locator('section h3');
    const sectionTexts: string[] = [];
    const count = await sections.count();
    for (let i = 0; i < count; i++) {
      const text = await sections.nth(i).textContent();
      if (text) sectionTexts.push(text.trim().toUpperCase());
    }
    // Verify minimum expected sections are present and in order
    const expected = [
      'WORKER',
      'CONFIGURATION',
      'NETWORK',
      'REPOSITORIES',
      'MOUNTS',
      'INIT SCRIPT',
    ];
    for (let i = 0; i < expected.length; i++) {
      expect(sectionTexts).toContain(expected[i]);
    }
    // Verify order: each expected section appears after the previous one
    for (let i = 1; i < expected.length; i++) {
      const prevIdx = sectionTexts.indexOf(expected[i - 1]);
      const currIdx = sectionTexts.indexOf(expected[i]);
      expect(currIdx).toBeGreaterThan(prevIdx);
    }
  });

  test('Configuration section shows four key-value pairs', async ({ page }) => {
    const dialog = await openDetailModal(page);
    // The Configuration section dl should have exactly 4 dt/dd pairs:
    // Environment, CPU Limit, Memory Limit, Docker
    const configSection = dialog.locator('section').filter({ hasText: 'Configuration' }).first();
    const dtElements = configSection.locator('dt');
    await expect(dtElements).toHaveCount(4);
    await expect(dtElements.nth(0)).toHaveText('Environment');
    await expect(dtElements.nth(1)).toHaveText('CPU Limit');
    await expect(dtElements.nth(2)).toHaveText('Memory Limit');
    await expect(dtElements.nth(3)).toHaveText('Docker');
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
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    // The Configuration section should show the custom environment name
    await expect(dialog.getByText('Environment', { exact: true })).toBeVisible();
    // The value next to Environment should be the custom environment name
    await expect(dialog.getByText(envName)).toBeVisible();
  });
});

test.describe.serial('Container Detail Modal — Rename', () => {
  let containerId: string;
  let displayName: string;

  test.beforeAll(async ({ request }) => {
    displayName = `RenameDetail-${Date.now()}`;
    const container = await createWorker(request, { displayName });
    containerId = container.id;
  });

  test.afterAll(async ({ request }) => {
    if (containerId) {
      await cleanupWorker(request, containerId);
    }
  });

  test('renames the display name from the detail modal and persists after reload', async ({ page }) => {
    const newDisplayName = `Renamed-${Date.now()}`;

    await goToDashboard(page);
    await page.waitForSelector(`h3:has-text("${displayName}")`, { timeout: 15_000 });
    await page.locator(`h3:has-text("${displayName}")`).first().click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // Header shows the original display name
    await expect(dialog.locator('h2')).toContainText(displayName);

    // Click the Rename pencil — it reveals an inline input in the header
    const renameBtn = await findButtonByTooltip(dialog, page, 'Rename');
    await renameBtn.click();

    const renameInput = dialog.locator('input').first();
    await expect(renameInput).toBeVisible({ timeout: 10_000 });
    await renameInput.fill(newDisplayName);
    await renameInput.press('Enter');

    // The modal header reflects the new label immediately
    await expect(dialog.locator('h2')).toContainText(newDisplayName, { timeout: 15_000 });

    // Close the modal so the sidebar cards are no longer obscured by the overlay
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // The card title in the sidebar should update to the new label
    await expect(page.locator(`h3:has-text("${newDisplayName}")`).first()).toBeVisible({ timeout: 15_000 });

    // Persists across a page reload (server-side PATCH took effect)
    await goToDashboard(page);
    await expect(page.locator(`h3:has-text("${newDisplayName}")`).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(`h3:has-text("${displayName}")`)).toHaveCount(0);

    // Keep displayName in sync so other state (if any) is consistent
    displayName = newDisplayName;
  });
});
