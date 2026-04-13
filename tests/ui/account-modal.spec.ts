import { test, expect } from '@playwright/test';
import { createTestUser, signInBrowserAsUser, deleteTestUser, type CreatedUser } from '../helpers/test-users';

// Use a fresh browser context per test and sign in as a test user so we can
// mutate profile/password freely without affecting the global admin state.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Account modal', () => {
  let user: CreatedUser;

  test.beforeEach(async () => {
    user = await createTestUser('Account UI');
  });

  test.afterEach(async () => {
    if (user) await deleteTestUser(user.id);
  });

  test('opens from the sidebar footer and shows profile + password sections', async ({ page, context }) => {
    await signInBrowserAsUser(context, user.email, user.password);
    await page.goto('/');
    await page.waitForSelector('h1:has-text("Agentor")', { timeout: 15_000 });

    await page.getByRole('button', { name: 'Account settings' }).click();
    await expect(page.getByRole('heading', { name: 'Account settings' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Change password' })).toBeVisible();
  });

  test('updates the user name', async ({ page, context }) => {
    await signInBrowserAsUser(context, user.email, user.password);
    await page.goto('/');
    await page.waitForSelector('h1:has-text("Agentor")', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Account settings' }).click();

    const newName = `Renamed ${Date.now()}`;
    await page.getByLabel('Name', { exact: true }).fill(newName);
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Profile updated')).toBeVisible({ timeout: 10_000 });

    // Close and reopen the modal — the field should still show the new name
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Account settings' }).click();
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue(newName);
  });

  test('updates the user email and the new email signs in', async ({ page, context }) => {
    await signInBrowserAsUser(context, user.email, user.password);
    await page.goto('/');
    await page.waitForSelector('h1:has-text("Agentor")', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Account settings' }).click();

    const newEmail = `renamed-${Date.now()}@test.example`;
    await page.getByLabel('Email', { exact: true }).fill(newEmail);
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Profile updated')).toBeVisible({ timeout: 10_000 });

    // Sign out and sign back in with the new email to confirm the change
    // actually landed in the database.
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL((url) => url.pathname === '/login', { timeout: 10_000 });

    await page.fill('input[type="email"]', newEmail);
    await page.fill('input[type="password"]', user.password);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => url.pathname === '/' || url.pathname === '', { timeout: 15_000 });
    await expect(page.locator('h1:has-text("Agentor")')).toBeVisible();
  });

  test('changes password with known current password', async ({ page, context }) => {
    await signInBrowserAsUser(context, user.email, user.password);
    await page.goto('/');
    await page.waitForSelector('h1:has-text("Agentor")', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Account settings' }).click();

    const newPassword = 'brand-new-account-modal-pw-12345';
    await page.getByLabel('Current password', { exact: true }).fill(user.password);
    await page.getByLabel('New password', { exact: true }).fill(newPassword);
    await page.getByLabel('Confirm new password', { exact: true }).fill(newPassword);
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText('Password changed')).toBeVisible({ timeout: 10_000 });

    // Verify: sign out then sign in with the new password
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL((url) => url.pathname === '/login', { timeout: 10_000 });

    await page.fill('input[type="email"]', user.email);
    await page.fill('input[type="password"]', newPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => url.pathname === '/' || url.pathname === '', { timeout: 15_000 });
    await expect(page.locator('h1:has-text("Agentor")')).toBeVisible();
  });

  test('close button dismisses the modal', async ({ page, context }) => {
    await signInBrowserAsUser(context, user.email, user.password);
    await page.goto('/');
    await page.waitForSelector('h1:has-text("Agentor")', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Account settings' }).click();
    await expect(page.getByRole('heading', { name: 'Account settings' })).toBeVisible();

    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Account settings' })).toHaveCount(0);
  });
});
