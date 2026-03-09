import { test, expect } from '@playwright/test';
import { goToDashboard, openCreateWorkerModal } from '../helpers/ui-helpers';

test.describe('Cross-Modal Navigation from Create Worker Modal', () => {

  test('clicking Manage next to Environment opens Environments Modal', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog.locator('h2')).toHaveText('New Worker', { timeout: 5_000 });

    // The first Manage button is for Environments
    const manageButtons = dialog.locator('button:has-text("Manage")');
    await manageButtons.first().click();

    // After a delay (350ms setTimeout in index.vue), the Environments Modal should open
    // The same dialog locator will find the new modal
    await expect(dialog.locator('h2')).toHaveText('Environments', { timeout: 10_000 });
  });

  test('clicking Manage next to Init Script opens Init Scripts Modal', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog.locator('h2')).toHaveText('New Worker', { timeout: 5_000 });

    // The second Manage button is for Init Scripts
    const manageButtons = dialog.locator('button:has-text("Manage")');
    await manageButtons.nth(1).click();

    // After a delay, the Init Scripts Modal should open
    await expect(dialog.locator('h2')).toHaveText('Init Scripts', { timeout: 10_000 });
  });

  test('Create Worker Modal closes when Manage (Environments) is clicked', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog.locator('h2')).toHaveText('New Worker', { timeout: 5_000 });

    // Click the first Manage button (Environments)
    const manageButtons = dialog.locator('button:has-text("Manage")');
    await manageButtons.first().click();

    // Wait for the transition — the dialog h2 should switch away from "New Worker"
    await page.waitForTimeout(500);

    // If a dialog is visible, it should NOT be the Create Worker modal
    const visibleDialog = page.locator('[role="dialog"]');
    if (await visibleDialog.isVisible()) {
      const title = await visibleDialog.locator('h2').textContent();
      expect(title).not.toBe('New Worker');
    }
  });

  test('Create Worker Modal closes when Manage (Init Scripts) is clicked', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog.locator('h2')).toHaveText('New Worker', { timeout: 5_000 });

    // Click the second Manage button (Init Scripts)
    const manageButtons = dialog.locator('button:has-text("Manage")');
    await manageButtons.nth(1).click();

    // Wait for the transition
    await page.waitForTimeout(500);

    // If a dialog is visible, it should NOT be the Create Worker modal
    const visibleDialog = page.locator('[role="dialog"]');
    if (await visibleDialog.isVisible()) {
      const title = await visibleDialog.locator('h2').textContent();
      expect(title).not.toBe('New Worker');
    }
  });

  test('after closing Environments Modal, Create Worker Modal can be re-opened', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog.locator('h2')).toHaveText('New Worker', { timeout: 5_000 });

    // Click Manage (Environments) to navigate away
    const manageButtons = dialog.locator('button:has-text("Manage")');
    await manageButtons.first().click();

    // Wait for Environments Modal to appear
    await expect(dialog.locator('h2')).toHaveText('Environments', { timeout: 10_000 });

    // Close the Environments Modal
    await dialog.locator('button:has-text("Close")').click();
    await page.waitForTimeout(500);

    // Re-open the Create Worker Modal
    await openCreateWorkerModal(page);
    await expect(page.locator('[role="dialog"]').locator('h2')).toHaveText('New Worker', { timeout: 5_000 });
  });

  test('after closing Init Scripts Modal, Create Worker Modal can be re-opened', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog.locator('h2')).toHaveText('New Worker', { timeout: 5_000 });

    // Click Manage (Init Scripts) to navigate away
    const manageButtons = dialog.locator('button:has-text("Manage")');
    await manageButtons.nth(1).click();

    // Wait for Init Scripts Modal to appear
    await expect(dialog.locator('h2')).toHaveText('Init Scripts', { timeout: 10_000 });

    // Close the Init Scripts Modal
    await dialog.locator('button:has-text("Close")').click();
    await page.waitForTimeout(500);

    // Re-open the Create Worker Modal
    await openCreateWorkerModal(page);
    await expect(page.locator('[role="dialog"]').locator('h2')).toHaveText('New Worker', { timeout: 5_000 });
  });
});
