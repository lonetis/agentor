import { test, expect } from '@playwright/test';
import { goToDashboard, openEnvironmentsModal } from '../helpers/ui-helpers';

/**
 * Opens the environment editor "New" form inside the environments modal.
 */
async function openNewEnvironmentEditor(page: import('@playwright/test').Page) {
  await goToDashboard(page);
  await openEnvironmentsModal(page);
  const dialog = page.locator('[role="dialog"]');
  await dialog.getByRole('button', { name: 'New', exact: true }).click();
  // Wait for the editor to render — Network Access fieldset is always present
  await expect(dialog.locator('legend:has-text("Network Access")')).toBeVisible({ timeout: 5_000 });
  return dialog;
}

/**
 * Clicks a network mode radio card by its label text.
 * Labels are structured as: <label><input/><span>Label</span></label>
 * plus a description. We target the span with the label text to find the right label element.
 */
async function selectNetworkMode(dialog: import('@playwright/test').Locator, label: string) {
  // Find the span inside a label element that has the exact label text
  const labelSpan = dialog.locator('fieldset:has(legend:has-text("Network Access")) label span.font-medium').filter({ hasText: new RegExp(`^${label}$`) });
  await labelSpan.click();
}

/**
 * Returns the currently selected network mode label by checking border-primary class.
 */
async function getSelectedNetworkModeLabel(dialog: import('@playwright/test').Locator): Promise<string | null> {
  const labels = dialog.locator('fieldset:has(legend:has-text("Network Access")) label');
  const count = await labels.count();
  for (let i = 0; i < count; i++) {
    const label = labels.nth(i);
    const cls = await label.getAttribute('class');
    if (cls && (cls.includes('border-primary') || cls.includes('bg-primary'))) {
      const text = await label.locator('span.font-medium').textContent();
      return text?.trim() ?? null;
    }
  }
  return null;
}

test.describe('Environment Editor — Network Mode', () => {
  test('default network mode is Full', async ({ page }) => {
    const dialog = await openNewEnvironmentEditor(page);

    const selected = await getSelectedNetworkModeLabel(dialog);
    expect(selected).toBe('Full');
  });

  test('switching to Package managers shows selected state', async ({ page }) => {
    const dialog = await openNewEnvironmentEditor(page);

    await selectNetworkMode(dialog, 'Package managers');

    const selected = await getSelectedNetworkModeLabel(dialog);
    expect(selected).toBe('Package managers');
  });

  test('switching to Custom reveals allowed domains textarea', async ({ page }) => {
    const dialog = await openNewEnvironmentEditor(page);

    await selectNetworkMode(dialog, 'Custom');

    // Allowed domains label should be visible
    await expect(dialog.getByText('Allowed domains')).toBeVisible({ timeout: 5_000 });
    // The textarea with wildcard placeholder should appear
    const textarea = dialog.locator('textarea').filter({ has: dialog.page().locator(':scope') });
    // Just check the Allowed domains label and a textarea is visible after switching
    const textareas = dialog.locator('textarea');
    const count = await textareas.count();
    // Should have at least 2 textareas now (allowed domains + setup script at the bottom)
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('Custom mode shows Include package manager domains checkbox', async ({ page }) => {
    const dialog = await openNewEnvironmentEditor(page);

    await selectNetworkMode(dialog, 'Custom');

    await expect(dialog.getByText('Also include package manager domains')).toBeVisible({ timeout: 5_000 });
  });

  test('switching to Block shows selected state', async ({ page }) => {
    const dialog = await openNewEnvironmentEditor(page);

    await selectNetworkMode(dialog, 'Block');

    const selected = await getSelectedNetworkModeLabel(dialog);
    expect(selected).toBe('Block');
  });

  test('switching to Block all shows selected state', async ({ page }) => {
    const dialog = await openNewEnvironmentEditor(page);

    await selectNetworkMode(dialog, 'Block all');

    const selected = await getSelectedNetworkModeLabel(dialog);
    expect(selected).toBe('Block all');
  });

  test('switching from restricted mode back to Full hides agent API domains viewer', async ({ page }) => {
    const dialog = await openNewEnvironmentEditor(page);

    // First switch to Block (restricted mode) which shows agent API domains
    await selectNetworkMode(dialog, 'Block');
    // The agent API domains viewer button should appear
    const agentDomainsBtn = dialog.locator('button').filter({ hasText: /agent API domains/ });
    await expect(agentDomainsBtn).toBeVisible({ timeout: 5_000 });

    // Now switch back to Full
    await selectNetworkMode(dialog, 'Full');

    // Agent API domains viewer should be hidden in Full mode
    await expect(agentDomainsBtn).toBeHidden({ timeout: 5_000 });
  });

  test('agent API domains viewer is shown in Block mode but not in Full or Block all', async ({ page }) => {
    const dialog = await openNewEnvironmentEditor(page);
    const agentDomainsBtn = dialog.locator('button').filter({ hasText: /agent API domains/ });

    // Full mode (default): no agent API domains viewer
    await expect(agentDomainsBtn).toBeHidden();

    // Block mode: agent API domains viewer should appear
    await selectNetworkMode(dialog, 'Block');
    await expect(agentDomainsBtn).toBeVisible({ timeout: 5_000 });

    // Block all mode: agent API domains viewer should be hidden
    await selectNetworkMode(dialog, 'Block all');
    await expect(agentDomainsBtn).toBeHidden({ timeout: 5_000 });
  });

  test('agent API domains viewer is shown in Package managers and Custom modes', async ({ page }) => {
    const dialog = await openNewEnvironmentEditor(page);
    const agentDomainsBtn = dialog.locator('button').filter({ hasText: /agent API domains/ });

    // Package managers mode
    await selectNetworkMode(dialog, 'Package managers');
    await expect(agentDomainsBtn).toBeVisible({ timeout: 5_000 });

    // Custom mode
    await selectNetworkMode(dialog, 'Custom');
    await expect(agentDomainsBtn).toBeVisible({ timeout: 5_000 });
  });

  test('package manager domains viewer is shown in Package managers mode', async ({ page }) => {
    const dialog = await openNewEnvironmentEditor(page);
    const pmDomainsBtn = dialog.locator('button').filter({ hasText: /package manager domains/ });

    // Not visible in Full mode
    await expect(pmDomainsBtn).toBeHidden();

    // Switch to Package managers
    await selectNetworkMode(dialog, 'Package managers');
    await expect(pmDomainsBtn).toBeVisible({ timeout: 5_000 });
  });

  test('package manager domains viewer is shown in Custom mode when checkbox is checked', async ({ page }) => {
    const dialog = await openNewEnvironmentEditor(page);
    const pmDomainsBtn = dialog.locator('button').filter({ hasText: /package manager domains/ });

    await selectNetworkMode(dialog, 'Custom');

    // Initially, PM domains viewer is hidden (checkbox unchecked)
    await expect(pmDomainsBtn).toBeHidden();

    // Check the "Also include package manager domains" checkbox
    const pmCheckbox = dialog.getByText('Also include package manager domains');
    await pmCheckbox.click();

    // Now the package manager domains viewer should appear
    await expect(pmDomainsBtn).toBeVisible({ timeout: 5_000 });
  });
});
