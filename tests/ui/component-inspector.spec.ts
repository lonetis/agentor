import { test, expect } from '@playwright/test';

test('component inspection keeps the account modal and its draft open', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Account settings', exact: true })).toBeVisible();
  test.skip(await page.locator('script[src*="/@vite/client"]').count() === 0, 'Nuxt DevTools require the dev server');

  const inspectorToggle = page.getByTitle('Toggle Component Inspector');
  await expect(inspectorToggle).toBeVisible();
  await page.getByRole('button', { name: 'Account settings', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const name = dialog.getByLabel('Name', { exact: true });
  await name.fill('Unsaved inspector draft');

  await inspectorToggle.click();
  // The toolbar briefly opens DevTools while enabling the inspector.
  await expect.poll(() => page.evaluate(() => {
    const host = (window as any).__NUXT_DEVTOOLS_HOST__;
    return host?.inspector?.isEnabled.value === true && !host.app.frameState.value.open;
  })).toBe(true);
  await expect(dialog).toBeVisible();
  await expect(name).toHaveValue('Unsaved inspector draft');

  await name.hover();
  await name.click();
  const inspectorPanel = page.locator('nuxt-devtools-inspect-panel');
  await expect(inspectorPanel.getByTitle('Close', { exact: true })).toBeVisible();
  await inspectorPanel.getByTitle('Close', { exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(name).toHaveValue('Unsaved inspector draft');

  // Ordinary dismissal still works after using the inspector.
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Account settings', exact: true }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Account settings', exact: true }).click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(10, 10);
  await expect(dialog).toBeHidden();
});
