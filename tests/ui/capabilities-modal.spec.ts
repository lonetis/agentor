import { test, expect } from '@playwright/test';
import { goToDashboard } from '../helpers/ui-helpers';
import { ApiClient } from '../helpers/api-client';

test.describe('Capabilities Modal', () => {
  test('Capabilities button is visible in sidebar and opens modal dialog', async ({ page }) => {
    await goToDashboard(page);
    const capabilitiesBtn = page.locator('button:has-text("Capabilities")');
    await expect(capabilitiesBtn).toBeVisible({ timeout: 10_000 });
    await capabilitiesBtn.click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
  });

  test('modal has "Capabilities" title', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Capabilities")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog.locator('h2')).toHaveText('Capabilities');
  });

  test('modal has "New" and "Close" buttons', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Capabilities")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog.locator('button:has-text("New")')).toBeVisible();
    await expect(dialog.locator('button:has-text("Close")')).toBeVisible();
  });

  test('built-in capabilities are listed', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Capabilities")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    const builtInCapabilities = ['port-mapping', 'domain-mapping', 'usage', 'tmux'];
    for (const name of builtInCapabilities) {
      await expect(dialog.getByText(name, { exact: false })).toBeVisible({ timeout: 10_000 });
    }
  });

  test('built-in capabilities show "Built-in" badge', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Capabilities")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    const badges = dialog.getByText('Built-in');
    await expect(badges.first()).toBeVisible({ timeout: 10_000 });
    // There should be at least 4 built-in badges (one per built-in capability)
    expect(await badges.count()).toBeGreaterThanOrEqual(4);
  });

  test('Close button closes the modal', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Capabilities")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    await dialog.locator('button:has-text("Close")').click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
  });

  test('Escape key closes the modal', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Capabilities")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 10_000 });
  });

  test('"New" button shows editor form with name input and content textarea', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Capabilities")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    await dialog.locator('button:has-text("New")').click();

    // Editor should show Name field and Content field
    await expect(dialog.getByText('Name', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByText('Content')).toBeVisible({ timeout: 10_000 });

    // Input and textarea should be present
    await expect(dialog.locator('input[placeholder="Capability name"]')).toBeVisible();
    await expect(dialog.locator('textarea')).toBeVisible();
  });

  test('Cancel in editor returns to list view', async ({ page }) => {
    await goToDashboard(page);
    await page.locator('button:has-text("Capabilities")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    await dialog.locator('button:has-text("New")').click();
    await expect(dialog.getByText('Name', { exact: true })).toBeVisible({ timeout: 10_000 });

    await dialog.locator('button:has-text("Cancel")').click();

    // Should be back at the list — "New" button should be visible again
    await expect(dialog.locator('button:has-text("New")')).toBeVisible({ timeout: 10_000 });
    // Built-in capabilities should be visible again
    await expect(dialog.getByText('tmux')).toBeVisible({ timeout: 10_000 });
  });

  test('create flow: fill name + content, save, verify appears in list', async ({ page, request }) => {
    const api = new ApiClient(request);
    const capabilityName = `test-capability-${Date.now()}`;

    try {
      await goToDashboard(page);
      await page.locator('button:has-text("Capabilities")').click();
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 10_000 });

      await dialog.locator('button:has-text("New")').click();
      await expect(dialog.locator('input[placeholder="Capability name"]')).toBeVisible({ timeout: 10_000 });

      await dialog.locator('input[placeholder="Capability name"]').fill(capabilityName);
      await dialog.locator('textarea').fill('---\ndescription: Test capability\n---\n\nTest content');

      await dialog.locator('button:has-text("Create")').click();

      // Should return to list and show the new capability
      await expect(dialog.locator('button:has-text("New")')).toBeVisible({ timeout: 10_000 });
      await expect(dialog.getByText(capabilityName)).toBeVisible({ timeout: 10_000 });
    } finally {
      // Cleanup: delete the capability we just created
      const { body: capabilities } = await api.listCapabilities();
      const created = capabilities.find((s: { name: string }) => s.name === capabilityName);
      if (created) await api.deleteCapability(created.id);
    }
  });
});
