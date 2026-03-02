import { test, expect } from '@playwright/test';
import { goToDashboard, openCreateWorkerModal } from '../helpers/ui-helpers';

test.describe('Init Preset Selector', () => {

  test('shows None as default preset selection', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');
    // The Init Script section should have a preset selector with "None" selected
    await expect(dialog.getByText('Init Script', { exact: true }).first()).toBeVisible();
    // The USelect for init preset should show "None" as the current value
    await expect(dialog.getByText('None')).toBeVisible();
  });

  test('shows init script textarea', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');
    // The textarea for init script should be present with a placeholder
    const textarea = dialog.locator('textarea');
    await expect(textarea).toBeVisible();
    const placeholder = await textarea.getAttribute('placeholder');
    expect(placeholder).toContain('#!/bin/bash');
  });

  test('init script textarea is empty by default', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');
    const textarea = dialog.locator('textarea');
    await expect(textarea).toBeVisible();
    const value = await textarea.inputValue();
    expect(value).toBe('');
  });

  test('typing in textarea switches preset to Custom', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');
    const textarea = dialog.locator('textarea');
    await expect(textarea).toBeVisible();
    // Type a custom script
    await textarea.fill('#!/bin/bash\necho "hello"');
    // Wait for the bidirectional sync to update the dropdown
    await page.waitForTimeout(500);
    // The preset selector should now show "Custom"
    await expect(dialog.getByText('Custom')).toBeVisible();
  });

  test('clearing textarea switches preset back to None', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');
    const textarea = dialog.locator('textarea');
    await expect(textarea).toBeVisible();
    // Type something first
    await textarea.fill('#!/bin/bash\necho "test"');
    await page.waitForTimeout(500);
    await expect(dialog.getByText('Custom')).toBeVisible();
    // Clear the textarea
    await textarea.fill('');
    await page.waitForTimeout(500);
    // Should switch back to None
    await expect(dialog.getByText('None')).toBeVisible();
  });

  test('init preset selector is a combobox with None default', async ({ page }) => {
    await goToDashboard(page);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');

    // The init preset is a combobox labeled "Init Script"
    const presetCombobox = dialog.locator('combobox[aria-label="Init Script"], [role="combobox"]').last();
    await expect(presetCombobox).toBeVisible();
    // The default value should be None
    await expect(presetCombobox.locator('text=None')).toBeVisible();
  });
});
