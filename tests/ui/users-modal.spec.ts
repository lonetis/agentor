import { test, expect } from '@playwright/test';
import { createTestUser, deleteTestUser, type CreatedUser } from '../helpers/test-users';

/**
 * Admin-only Users modal. Runs with the global admin storage state (default).
 */
test.describe('Users modal (admin)', () => {
  test('admin opens Users modal from the System tab', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('h1:has-text("Agentor")', { timeout: 15_000 });

    // Select the System tab (exact match — "System Settings" also contains "System").
    await page.getByRole('button', { name: 'System', exact: true }).click();
    // Click the Users quick link
    await page.getByRole('button', { name: 'Users', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
    // Scope to the modal dialog so we don't also match the sidebar account card.
    await expect(page.getByRole('dialog').getByText('admin@agentor.test')).toBeVisible();
  });

  test('admin can create a new user via the modal', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('h1:has-text("Agentor")', { timeout: 15_000 });
    await page.getByRole('button', { name: 'System', exact: true }).click();
    await page.getByRole('button', { name: 'Users', exact: true }).click();

    await page.getByRole('button', { name: 'New', exact: true }).click();

    const stamp = Date.now();
    const email = `modal-${stamp}@test.example`;
    await page.getByLabel('Name', { exact: true }).fill('Modal Created');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill('modal-pass-12345');

    await page.getByRole('button', { name: 'Create', exact: true }).click();

    // New user should appear in the list (data-user-row selector is stable)
    await expect(page.locator(`[data-user-row="${email}"]`)).toBeVisible({ timeout: 10_000 });
  });

  test('admin can make a user admin and demote them back', async ({ page }) => {
    const user = await createTestUser('Modal Role');
    try {
      await page.goto('/');
      await page.waitForSelector('h1:has-text("Agentor")', { timeout: 15_000 });
      await page.getByRole('button', { name: 'System', exact: true }).click();
      await page.getByRole('button', { name: 'Users', exact: true }).click();

      const row = page.locator(`[data-user-row="${user.email}"]`);
      await expect(row).toBeVisible({ timeout: 10_000 });

      // Promote
      await row.getByRole('button', { name: 'Make admin' }).click();
      await expect(row.getByRole('button', { name: 'Demote' })).toBeVisible({ timeout: 5_000 });

      // Demote
      await row.getByRole('button', { name: 'Demote' }).click();
      await expect(row.getByRole('button', { name: 'Make admin' })).toBeVisible({ timeout: 5_000 });
    } finally {
      await deleteTestUser(user.id);
    }
  });

  test('admin can delete a user via the modal', async ({ page }) => {
    const user = await createTestUser('Modal Delete');
    let deleted = false;
    try {
      await page.goto('/');
      await page.waitForSelector('h1:has-text("Agentor")', { timeout: 15_000 });
      await page.getByRole('button', { name: 'System', exact: true }).click();
      await page.getByRole('button', { name: 'Users', exact: true }).click();

      const row = page.locator(`[data-user-row="${user.email}"]`);
      await expect(row).toBeVisible({ timeout: 10_000 });

      page.once('dialog', (d) => d.accept());
      await row.getByRole('button', { name: 'Delete' }).click();

      // Row should disappear from the list
      await expect(row).toHaveCount(0, { timeout: 10_000 });
      deleted = true;
    } finally {
      if (!deleted) {
        await deleteTestUser(user.id);
      }
    }
  });

  test('admin can reset a user password via the modal', async ({ page, request }) => {
    const user = await createTestUser('Modal Reset');
    try {
      await page.goto('/');
      await page.waitForSelector('h1:has-text("Agentor")', { timeout: 15_000 });
      await page.getByRole('button', { name: 'System', exact: true }).click();
      await page.getByRole('button', { name: 'Users', exact: true }).click();

      const row = page.locator(`[data-user-row="${user.email}"]`);
      await expect(row).toBeVisible({ timeout: 10_000 });

      // The reset-password action uses window.prompt — override it before clicking.
      const newPassword = 'reset-via-modal-12345';
      await page.evaluate((pw) => {
        (window as any).prompt = () => pw;
      }, newPassword);

      // Wait for the admin set-user-password request to finish before
      // we try to sign in with the new password.
      const [setPasswordResponse] = await Promise.all([
        page.waitForResponse(
          (res) => res.url().includes('/api/auth/admin/set-user-password') && res.request().method() === 'POST',
          { timeout: 10_000 },
        ),
        row.getByRole('button', { name: 'Reset password' }).click(),
      ]);
      expect(setPasswordResponse.ok()).toBe(true);

      // Verify via a fresh request context — the `request` fixture has admin
      // cookies which would prevent a clean sign-in attempt.
      const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
      const freshCtx = await page.context().browser()!.newContext({
        baseURL: BASE_URL,
        ignoreHTTPSErrors: true,
      });
      try {
        const verifyRes = await freshCtx.request.post(`${BASE_URL}/api/auth/sign-in/email`, {
          headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
          data: { email: user.email, password: newPassword },
        });
        expect(verifyRes.ok()).toBe(true);
      } finally {
        await freshCtx.close();
      }
    } finally {
      await deleteTestUser(user.id);
    }
  });
});

/**
 * Non-admin users should not see the System tab at all.
 */
test.describe('Users modal — regular user', () => {
  let user: CreatedUser;

  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async () => {
    user = await createTestUser('No System');
  });

  test.afterEach(async () => {
    if (user) await deleteTestUser(user.id);
  });

  test('regular user does not see the System tab in the sidebar', async ({ page, context }) => {
    const res = await context.request.post('/api/auth/sign-in/email', {
      data: { email: user.email, password: user.password },
    });
    expect(res.ok()).toBe(true);

    await page.goto('/');
    await page.waitForSelector('h1:has-text("Agentor")', { timeout: 15_000 });

    // The System tab is hidden entirely for non-admins.
    const systemTab = page.getByRole('button', { name: 'System', exact: true });
    await expect(systemTab).toHaveCount(0);
  });
});
