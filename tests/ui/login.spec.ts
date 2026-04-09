import { test, expect } from '@playwright/test';
import { TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD } from '../global-setup';

// These tests run with NO storage state (fresh browser context) so they can
// exercise the login flow end-to-end without the global admin session.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Login page', () => {
  test('login page renders with email/password fields', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('wrong credentials show error message', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', TEST_ADMIN_EMAIL);
    await page.fill('input[type="password"]', 'wrong-password');
    await page.click('button[type="submit"]');
    // Error text should appear — any red error is fine
    await expect(page.locator('.text-red-600, .text-red-400')).toBeVisible({ timeout: 10_000 });
  });

  test('correct credentials redirect to dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', TEST_ADMIN_EMAIL);
    await page.fill('input[type="password"]', TEST_ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => url.pathname === '/' || url.pathname === '', { timeout: 15_000 });
    // Dashboard should load
    await expect(page.locator('h1:has-text("Agentor")')).toBeVisible({ timeout: 10_000 });
  });

  test('unauthenticated navigation to / redirects to /login', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL((url) => url.pathname === '/login', { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });
});
