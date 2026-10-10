import { test, expect } from '@playwright/test';
import { goToDashboard } from '../helpers/ui-helpers';
import { ApiClient } from '../helpers/api-client';

const resources = [
  {
    title: 'Capabilities',
    namePlaceholder: 'Capability name',
    initialContent: '',
    content: '---\ndescription: Modal reopen test\n---\n\nOriginal content.',
    create: 'createCapability',
    remove: 'deleteCapability',
  },
  {
    title: 'Instructions',
    namePlaceholder: 'Entry name',
    initialContent: '',
    content: '# Original\n\nOriginal content.',
    create: 'createInstruction',
    remove: 'deleteInstruction',
  },
  {
    title: 'Init Scripts',
    namePlaceholder: 'Script name',
    initialContent: '#!/bin/bash\n',
    content: '#!/bin/bash\necho original',
    create: 'createInitScript',
    remove: 'deleteInitScript',
  },
] as const;

for (const resource of resources) {
  test.describe(`${resource.title} modal reopening`, () => {
    for (const closeMethod of ['Close', 'Escape', 'outside click'] as const) {
      test(`reopening shows the list after dismissing an editor with ${closeMethod}`, async ({ page, request }) => {
        const api = new ApiClient(request);
        const name = `UIReopen-${resource.title}-${closeMethod}-${Date.now()}`;
        const { body: created } = await api[resource.create]({ name, content: resource.content });

        try {
          await goToDashboard(page);
          const openButton = page.getByRole('button', { name: resource.title, exact: true });
          await openButton.click();
          const dialog = page.getByRole('dialog');
          const nameInput = dialog.getByPlaceholder(resource.namePlaceholder, { exact: true });
          const contentInput = dialog.locator('textarea');
          const itemRow = dialog.locator('.rounded-lg').filter({ hasText: name });

          for (const mode of ['edit', 'create', 'view'] as const) {
            await test.step(`dismiss and reopen from ${mode} mode`, async () => {
              if (mode === 'edit') {
                await itemRow.getByRole('button', { name: 'Edit', exact: true }).click();
                await expect(nameInput).toHaveValue(name);
                await expect(contentInput).toHaveValue(resource.content);
              } else if (mode === 'create') {
                await dialog.getByRole('button', { name: 'New', exact: true }).click();
                await expect(nameInput).toHaveValue('');
                await expect(contentInput).toHaveValue(resource.initialContent);
              } else {
                await dialog.getByRole('button', { name: 'View', exact: true }).first().click();
                await expect(nameInput).toBeDisabled();
                await expect(contentInput).toBeDisabled();
              }

              if (mode !== 'view') {
                await nameInput.fill('Unsaved draft');
                await contentInput.fill('Unsaved content');
              }

              if (closeMethod === 'Close') {
                await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
              } else if (closeMethod === 'Escape') {
                await page.keyboard.press('Escape');
              } else {
                await page.mouse.click(10, 10);
              }
              await expect(dialog).toBeHidden();

              await openButton.click();
              await expect(dialog.getByRole('button', { name: 'New', exact: true })).toBeVisible();
              await expect(itemRow).toBeVisible();
              await expect(nameInput).toBeHidden();
              await expect(contentInput).toBeHidden();
            });
          }

          await dialog.getByRole('button', { name: 'New', exact: true }).click();
          await expect(nameInput).toBeEnabled();
          await expect(nameInput).toHaveValue('');
          await expect(contentInput).toBeEnabled();
          await expect(contentInput).toHaveValue(resource.initialContent);
        } finally {
          await api[resource.remove](created.id);
        }
      });
    }
  });
}
