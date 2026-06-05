import { test, expect } from '@playwright/test';
import { goToDashboard, findButtonByTooltip } from '../helpers/ui-helpers';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';
import { ApiClient } from '../helpers/api-client';

// The worker "detail" view is now an editable Worker Settings modal: a read-only
// identity section, an editable settings section (display name, environment,
// repositories, mounts, init script), and read-only mapping/app info.

test.describe.serial('Worker Settings Modal', () => {
  let containerId: string;
  let workerId: string;
  let dockerContainerId: string;
  let displayName: string;

  test.beforeAll(async ({ request }) => {
    displayName = `Detail-${Date.now()}`;
    const container = await createWorker(request, { displayName });
    containerId = container.id;
    workerId = container.id;
    dockerContainerId = container.containerId;
  });

  test.afterAll(async ({ request }) => {
    if (containerId) await cleanupWorker(request, containerId);
  });

  async function openModal(page: import('@playwright/test').Page) {
    await goToDashboard(page);
    await page.waitForSelector(`h3:has-text("${displayName}")`, { timeout: 15_000 });
    await page.locator(`h3:has-text("${displayName}")`).first().click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    return dialog;
  }

  test('opens when clicking the worker name', async ({ page }) => {
    await openModal(page);
  });

  test('opens when clicking the Settings pencil', async ({ page }) => {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    const btn = await findButtonByTooltip(card, page, 'Settings');
    await btn.click();
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 10_000 });
  });

  test('header shows the display name and a Settings suffix', async ({ page }) => {
    const dialog = await openModal(page);
    const h2 = dialog.locator('h2');
    await expect(h2).toContainText(displayName);
    await expect(h2).toContainText('Settings');
  });

  test('shows running status badge', async ({ page }) => {
    const dialog = await openModal(page);
    await expect(dialog.locator('text=running')).toBeVisible();
  });

  test('Worker identity section shows the five read-only fields', async ({ page }) => {
    const dialog = await openModal(page);
    const workerSection = dialog.locator('section').first();
    const dt = workerSection.locator('dt');
    await expect(dt).toHaveCount(5);
    await expect(dt.nth(0)).toHaveText('Worker ID');
    await expect(dt.nth(1)).toHaveText('Container ID');
    await expect(dt.nth(2)).toHaveText('Image');
    await expect(dt.nth(3)).toHaveText('Image ID');
    await expect(dt.nth(4)).toHaveText('Created');
  });

  test('Worker ID shows the worker id with a matching title', async ({ page }) => {
    const dialog = await openModal(page);
    // The worker id is now a UUID v4 (stable across rebuild).
    expect(workerId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    const idValue = dialog.locator('dd').filter({ hasText: workerId }).first();
    await expect(idValue).toBeVisible();
    expect(await idValue.getAttribute('title')).toBe(workerId);
  });

  test('Container ID shows the first 12 characters', async ({ page }) => {
    const dialog = await openModal(page);
    const truncated = dockerContainerId.slice(0, 12);
    const idValue = dialog.locator('dd').filter({ hasText: truncated }).first();
    await expect(idValue).toBeVisible();
    expect(await idValue.getAttribute('title')).toBe(dockerContainerId);
  });

  test('Created shows a formatted date, not a dash', async ({ page }) => {
    const dialog = await openModal(page);
    const lastDd = dialog.locator('section').first().locator('dd').last();
    const text = (await lastDd.textContent())!.trim();
    expect(text).not.toBe('—');
    expect(text).toMatch(/\d/);
  });

  test('Settings section exposes the editable fields', async ({ page }) => {
    const dialog = await openModal(page);
    await expect(dialog.getByText('Settings', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Display name', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Environment', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Repositories', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Volume Mounts', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Init Script', { exact: true })).toBeVisible();
  });

  test('fields are tagged no-rebuild vs requires-rebuild', async ({ page }) => {
    const dialog = await openModal(page);
    await expect(dialog.getByText('no rebuild needed', { exact: true })).toBeVisible();
    // environment, repos, mounts, init script each carry a "requires rebuild" tag
    await expect(dialog.getByText('requires rebuild')).toHaveCount(4);
  });

  test('display name field is pre-filled with the current label', async ({ page }) => {
    const dialog = await openModal(page);
    await expect(dialog.getByPlaceholder('Worker label')).toHaveValue(displayName);
  });

  test('Save is disabled when nothing has changed', async ({ page }) => {
    const dialog = await openModal(page);
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  });

  test('does NOT show environment-specific sections', async ({ page }) => {
    const dialog = await openModal(page);
    // CPU/Memory/Docker/Network/Capabilities/etc. belong to the environment modal
    await expect(dialog.getByText('CPU Limit', { exact: true })).toHaveCount(0);
    await expect(dialog.getByText('Memory Limit', { exact: true })).toHaveCount(0);
    await expect(dialog.getByText('Network', { exact: true })).toHaveCount(0);
    await expect(dialog.getByText('Setup Script', { exact: true })).toHaveCount(0);
    await expect(dialog.getByText('Exposed Worker APIs', { exact: true })).toHaveCount(0);
  });

  test('can close with Escape', async ({ page }) => {
    await openModal(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('[role="dialog"]')).toBeHidden({ timeout: 10_000 });
  });

  test('can close by clicking the overlay', async ({ page }) => {
    const dialog = await openModal(page);
    await page.mouse.click(8, 8);
    await expect(dialog).toBeHidden({ timeout: 10_000 });
  });

  test('can re-open after closing', async ({ page }) => {
    const dialog = await openModal(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await page.locator(`h3:has-text("${displayName}")`).first().click();
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog.locator('h2')).toContainText(displayName);
  });
});

test.describe.serial('Worker Settings Modal — custom environment', () => {
  let containerId: string;
  let displayName: string;
  let envId: string;
  const envName = `TestEnv-${Date.now()}`;

  test.beforeAll(async ({ request }) => {
    const api = new ApiClient(request);
    const { status, body } = await api.createEnvironment({ name: envName });
    expect(status).toBe(201);
    envId = body.id;
    displayName = `EnvDetail-${Date.now()}`;
    const container = await createWorker(request, { displayName, environmentId: envId });
    containerId = container.id;
  });

  test.afterAll(async ({ request }) => {
    if (containerId) await cleanupWorker(request, containerId);
    if (envId) {
      const api = new ApiClient(request);
      try { await api.deleteEnvironment(envId); } catch { /* ignore */ }
    }
  });

  test('Environment selector reflects the assigned environment', async ({ page }) => {
    await goToDashboard(page);
    await page.waitForSelector(`h3:has-text("${displayName}")`, { timeout: 15_000 });
    await page.locator(`h3:has-text("${displayName}")`).first().click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    // The Environment <select> trigger shows the assigned environment's name.
    await expect(dialog.getByText(envName).first()).toBeVisible();
  });
});
