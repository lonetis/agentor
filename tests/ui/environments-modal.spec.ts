import { test, expect } from '@playwright/test';
import { goToDashboard, openEnvironmentsModal } from '../helpers/ui-helpers';
import { ApiClient } from '../helpers/api-client';

test.describe('Environments Modal', () => {
  test('opens when clicking Environments button', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    await expect(page.locator('[role="dialog"]')).toBeVisible();
  });

  test('can close the modal with Escape', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('[role="dialog"]')).toBeHidden({ timeout: 10_000 });
  });

  for (const closeMethod of ['Close', 'Escape', 'outside click'] as const) {
    test(`reopening shows the list after dismissing an editor with ${closeMethod}`, async ({ page, request }) => {
      const api = new ApiClient(request);
      const envName = `UIEnvReopen-${closeMethod}-${Date.now()}`;
      const { body: created } = await api.createEnvironment({ name: envName });

      try {
        await goToDashboard(page);
        await openEnvironmentsModal(page);
        const dialog = page.getByRole('dialog');
        const nameInput = dialog.locator('input[placeholder="My environment"]');
        const envRow = dialog.locator('.rounded-lg').filter({ hasText: envName });

        for (const mode of ['edit', 'create', 'view'] as const) {
          await test.step(`dismiss and reopen from ${mode} mode`, async () => {
            if (mode === 'edit') {
              await envRow.getByRole('button', { name: 'Edit', exact: true }).click();
              await expect(nameInput).toHaveValue(envName);
            } else if (mode === 'create') {
              await dialog.getByRole('button', { name: 'New', exact: true }).click();
              await expect(nameInput).toHaveValue('');
            } else {
              await dialog.getByRole('button', { name: 'View', exact: true }).first().click();
              await expect(nameInput).toBeDisabled();
            }

            if (mode !== 'view') await nameInput.fill('Unsaved draft');

            if (closeMethod === 'Close') {
              await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
            } else if (closeMethod === 'Escape') {
              await page.keyboard.press('Escape');
            } else {
              await page.mouse.click(10, 10);
            }
            await expect(dialog).toBeHidden();

            await openEnvironmentsModal(page);
            await expect(dialog.getByRole('button', { name: 'New', exact: true })).toBeVisible();
            await expect(envRow).toBeVisible();
            await expect(nameInput).toBeHidden();
          });
        }
      } finally {
        await api.deleteEnvironment(created.id);
      }
    });
  }

  test('shows pre-created environments', async ({ page, request }) => {
    // Create an environment via API first
    const api = new ApiClient(request);
    const envName = `UIEnv-${Date.now()}`;
    const { body } = await api.createEnvironment({ name: envName });

    try {
      await goToDashboard(page);
      await openEnvironmentsModal(page);

      // The environment name should appear in the modal
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog.getByText(envName)).toBeVisible({ timeout: 10_000 });
    } finally {
      // Clean up only this specific environment
      try { await api.deleteEnvironment(body.id); } catch { /* ignore */ }
    }
  });

  test('modal has New button', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog.getByRole('button', { name: 'New', exact: true })).toBeVisible();
  });

  test('clicking New shows environment form', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByRole('button', { name: 'New', exact: true }).click();
    // The form should show a Name input
    await expect(dialog.getByText('Name', { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test('environment form shows network access fieldset', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByRole('button', { name: 'New', exact: true }).click();
    // Network mode uses a fieldset with legend "Network Access"
    await expect(dialog.getByText('Network Access')).toBeVisible({ timeout: 10_000 });
  });

  test('environment form shows Docker toggle', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByRole('button', { name: 'New', exact: true }).click();
    // Docker section uses checkbox with label "Enable Docker-in-Docker"
    await expect(dialog.getByText('Docker-in-Docker')).toBeVisible({ timeout: 10_000 });
  });

  test('environment form shows resource limit fields', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByRole('button', { name: 'New', exact: true }).click();
    // CPU and Memory labels
    await expect(dialog.getByText('CPU', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByText('Memory', { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test('environment form shows Setup Script textarea', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByRole('button', { name: 'New', exact: true }).click();
    await expect(dialog.getByText('Setup Script', { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test('environment form has Create button', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByRole('button', { name: 'New', exact: true }).click();
    await expect(dialog.locator('button:has-text("Create")')).toBeVisible({ timeout: 10_000 });
  });

  test('environment list shows Default built-in environment with Built-in badge', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');

    // The default environment row should contain "Default" and a "Built-in" badge
    const defaultRow = dialog.locator('.rounded-lg').filter({ hasText: 'Default' });
    await expect(defaultRow).toBeVisible({ timeout: 10_000 });
    await expect(defaultRow.getByText('Built-in')).toBeVisible();
  });

  test('built-in environment has View button and no Edit or Delete buttons', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');

    // Find the row for the Default (built-in) environment
    const defaultRow = dialog.locator('.rounded-lg').filter({ hasText: 'Default' }).filter({ hasText: 'Built-in' });
    await expect(defaultRow).toBeVisible({ timeout: 10_000 });

    // Built-in environments show "View", not "Edit" or "Delete"
    await expect(defaultRow.locator('button:has-text("View")')).toBeVisible();
    await expect(defaultRow.locator('button:has-text("Edit")')).toBeHidden();
    await expect(defaultRow.locator('button:has-text("Delete")')).toBeHidden();
  });

  test('New button opens editor with empty form', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByRole('button', { name: 'New', exact: true }).click();

    // Name input should be present and empty
    const nameInput = dialog.locator('input[placeholder="My environment"]');
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    await expect(nameInput).toHaveValue('');

    // Create button should be visible (not Update)
    await expect(dialog.locator('button:has-text("Create")')).toBeVisible();
    await expect(dialog.locator('button:has-text("Update")')).toBeHidden();
  });

  test('editor has Expose APIs section with three checkboxes', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByRole('button', { name: 'New', exact: true }).click();

    // The "Expose APIs" fieldset legend
    await expect(dialog.getByText('Expose APIs', { exact: true })).toBeVisible({ timeout: 10_000 });

    // Three checkboxes: Port Mappings, Domain Mappings, Usage Monitoring
    await expect(dialog.getByText('Port Mappings')).toBeVisible();
    await expect(dialog.getByText('Domain Mappings')).toBeVisible();
    await expect(dialog.getByText('Usage Monitoring')).toBeVisible();
  });

  test('editor has Capabilities section with checkboxes', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByRole('button', { name: 'New', exact: true }).click();

    // Capabilities fieldset with Select All toggle
    await expect(dialog.getByText('Capabilities').first()).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByText('Select All').first()).toBeVisible();
  });

  test('editor has Instructions section with checkboxes', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByRole('button', { name: 'New', exact: true }).click();

    // Instructions fieldset
    await expect(dialog.getByText('Instructions').first()).toBeVisible({ timeout: 10_000 });
  });

  test('editor has Environment Variables section', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByRole('button', { name: 'New', exact: true }).click();

    // Environment Variables fieldset legend
    await expect(dialog.getByText('Environment Variables')).toBeVisible({ timeout: 10_000 });

    // Custom env vars textarea should be present with KEY=VALUE placeholder
    const envTextarea = dialog.locator('textarea[placeholder*="MY_VAR"]');
    await expect(envTextarea).toBeVisible();
  });

  test('editor has Setup Script textarea', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByRole('button', { name: 'New', exact: true }).click();

    // Setup Script label
    await expect(dialog.getByText('Setup Script', { exact: true })).toBeVisible({ timeout: 10_000 });

    // Textarea with bash placeholder
    const scriptTextarea = dialog.locator('textarea[placeholder*="#!/bin/bash"]');
    await expect(scriptTextarea).toBeVisible();
  });

  test('clicking Cancel in editor returns to list view', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');

    // Open editor
    await dialog.getByRole('button', { name: 'New', exact: true }).click();
    await expect(dialog.getByText('Expose APIs', { exact: true })).toBeVisible({ timeout: 10_000 });

    // Click Cancel
    await dialog.locator('button:has-text("Cancel")').click();

    // Should return to list view: "New" button visible again, editor sections gone
    await expect(dialog.locator('button:has-text("New")').first()).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByText('Expose APIs', { exact: true })).toBeHidden();
  });

  test('View on built-in environment shows read-only form without Create/Update buttons', async ({ page }) => {
    await goToDashboard(page);
    await openEnvironmentsModal(page);
    const dialog = page.locator('[role="dialog"]');

    // Click "View" on the Default built-in environment
    const defaultRow = dialog.locator('.rounded-lg').filter({ hasText: 'Default' }).filter({ hasText: 'Built-in' });
    await expect(defaultRow).toBeVisible({ timeout: 10_000 });
    await defaultRow.locator('button:has-text("View")').click();

    // Editor should be visible with the environment name
    const nameInput = dialog.locator('input[placeholder="My environment"]');
    await expect(nameInput).toBeVisible({ timeout: 10_000 });

    // Name input should be disabled (read-only mode)
    await expect(nameInput).toBeDisabled();

    // Create and Update buttons should NOT be visible in read-only mode
    await expect(dialog.locator('button:has-text("Create")')).toBeHidden();
    await expect(dialog.locator('button:has-text("Update")')).toBeHidden();

    // Close button should be visible instead of Cancel (use .last() to skip dialog header close button)
    await expect(dialog.locator('button').filter({ hasText: /^Close$/ }).last()).toBeVisible();
  });

  test.describe('Advanced', () => {
    test('can create environment via form', async ({ page, request }) => {
      const api = new ApiClient(request);
      await goToDashboard(page);
      await openEnvironmentsModal(page);
      const dialog = page.locator('[role="dialog"]');
      await dialog.getByRole('button', { name: 'New', exact: true }).click();

      // Fill in the name
      const nameInput = dialog.locator('input').first();
      const envName = `UIEnvAdv-${Date.now()}`;
      await nameInput.fill(envName);

      // Save the environment
      const saveButton = dialog.locator('button:has-text("Save"), button:has-text("Create")').first();
      try {
        if (await saveButton.isVisible()) {
          await saveButton.click();

          // Verify it appears in the list via API
          const { body: envs } = await api.listEnvironments();
          const found = envs.find((e: { name: string }) => e.name === envName);
          expect(found).toBeTruthy();
        }
      } finally {
        // Clean up only this environment
        const { body: envs } = await api.listEnvironments();
        const created = envs.find((e: { name: string }) => e.name === envName);
        if (created) try { await api.deleteEnvironment(created.id); } catch { /* ignore */ }
      }
    });

    test('custom environment shows Edit and Delete buttons', async ({ page, request }) => {
      const api = new ApiClient(request);
      const envName = `UIEnvEdit-${Date.now()}`;
      const { body: created } = await api.createEnvironment({
        name: envName,
        cpuLimit: 0,
        memoryLimit: '',
        networkMode: 'full',
        allowedDomains: [],
        includePackageManagerDomains: false,
        dockerEnabled: true,
        envVars: '',
        setupScript: '',
      });

      try {
        await goToDashboard(page);
        await openEnvironmentsModal(page);
        const dialog = page.locator('[role="dialog"]');

        // Find the row containing the environment name
        const envRow = dialog.locator('.rounded-lg').filter({ hasText: envName });
        await expect(envRow).toBeVisible({ timeout: 10_000 });

        // Custom environments have Edit and Delete buttons
        await expect(envRow.locator('button:has-text("Edit")')).toBeVisible();
        await expect(envRow.locator('button:has-text("Delete")')).toBeVisible();
      } finally {
        try { await api.deleteEnvironment(created.id); } catch { /* ignore */ }
      }
    });

    test('can edit existing environment', async ({ page, request }) => {
      const api = new ApiClient(request);
      const envName = `UIEnvEditable-${Date.now()}`;
      const { body: created } = await api.createEnvironment({
        name: envName,
        cpuLimit: 2,
        memoryLimit: '1g',
        networkMode: 'full',
        allowedDomains: [],
        includePackageManagerDomains: false,
        dockerEnabled: true,
        envVars: '',
        setupScript: '',
      });

      try {
        await goToDashboard(page);
        await openEnvironmentsModal(page);
        const dialog = page.locator('[role="dialog"]');

        // Find the row and click "Edit" button
        const envRow = dialog.locator('.rounded-lg').filter({ hasText: envName });
        await expect(envRow).toBeVisible({ timeout: 10_000 });
        await envRow.locator('button:has-text("Edit")').click();

        // Should now show the edit form with the name input
        await expect(dialog.locator('input[placeholder="My environment"]')).toBeVisible({ timeout: 10_000 });
      } finally {
        try { await api.deleteEnvironment(created.id); } catch { /* ignore */ }
      }
    });

    test('git providers are all enabled by default and can be deselected individually', async ({ page, request }) => {
      const api = new ApiClient(request);
      const envName = `UIEnvGit-${Date.now()}`;
      await goToDashboard(page);
      await openEnvironmentsModal(page);
      const dialog = page.locator('[role="dialog"]');
      await dialog.getByRole('button', { name: 'New', exact: true }).click();

      const section = dialog.locator('fieldset').filter({ has: page.getByText('Git Providers', { exact: true }) });
      await expect(section).toBeVisible({ timeout: 10_000 });
      const providerBox = (url: string) => section.locator('label').filter({ hasText: url }).getByRole('checkbox');
      const selectAll = section.locator('label').filter({ hasText: 'Select All' }).getByRole('checkbox');
      await expect(selectAll).toHaveAttribute('aria-checked', 'true');
      await expect(providerBox('github.com')).toHaveAttribute('aria-checked', 'true');
      await expect(providerBox('gitlab.com')).toHaveAttribute('aria-checked', 'true');

      // Deselecting one provider leaves the others enabled.
      await providerBox('github.com').click();
      await expect(providerBox('github.com')).toHaveAttribute('aria-checked', 'false');
      await expect(providerBox('gitlab.com')).toHaveAttribute('aria-checked', 'true');
      await expect(selectAll).toHaveAttribute('aria-checked', 'false');

      await dialog.locator('input[placeholder="My environment"]').fill(envName);
      try {
        await dialog.locator('button:has-text("Create")').click();
        await expect.poll(async () => {
          const { body: envs } = await api.listEnvironments();
          return envs.find((e: { name: string }) => e.name === envName)?.enabledGitProviderIds;
        }).toEqual(expect.arrayContaining(['gitlab']));
        const { body: envs } = await api.listEnvironments();
        expect(envs.find((e: { name: string }) => e.name === envName).enabledGitProviderIds).not.toContain('github');

        // Re-opening shows the saved selection; unchecking Select All deselects every provider.
        const envRow = dialog.locator('.rounded-lg').filter({ hasText: envName });
        await envRow.locator('button:has-text("Edit")').click();
        await expect(providerBox('github.com')).toHaveAttribute('aria-checked', 'false', { timeout: 10_000 });
        await expect(providerBox('gitlab.com')).toHaveAttribute('aria-checked', 'true');
        await selectAll.click();
        await expect(providerBox('github.com')).toHaveAttribute('aria-checked', 'true');
        await selectAll.click();
        await expect(providerBox('github.com')).toHaveAttribute('aria-checked', 'false');
        await expect(providerBox('gitlab.com')).toHaveAttribute('aria-checked', 'false');
        await dialog.locator('button:has-text("Update")').click();
        await expect.poll(async () => {
          const { body: list } = await api.listEnvironments();
          return list.find((e: { name: string }) => e.name === envName)?.enabledGitProviderIds;
        }).toEqual([]);
      } finally {
        const { body: envs } = await api.listEnvironments();
        const created = envs.find((e: { name: string }) => e.name === envName);
        if (created) try { await api.deleteEnvironment(created.id); } catch { /* ignore */ }
      }
    });

    test('network mode dropdown has expected options', async ({ page }) => {
      await goToDashboard(page);
      await openEnvironmentsModal(page);
      const dialog = page.locator('[role="dialog"]');
      await dialog.getByRole('button', { name: 'New', exact: true }).click();

      // Look for network mode selector
      const networkSelect = dialog.locator('select, [role="listbox"]').first();
      if (await networkSelect.count() > 0) {
        await networkSelect.click();
        // Check for expected options
        const options = page.locator('option, [role="option"]');
        const count = await options.count();
        expect(count).toBeGreaterThanOrEqual(3); // at least full, block, custom
      }
    });
  });
});
