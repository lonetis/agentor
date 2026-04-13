import { test, expect } from '@playwright/test';

/**
 * Client-side route guard (`app/middleware/auth.global.ts`) — redirects
 * unauthenticated users to /login, signed-in users away from /login, and
 * handles the first-run setup redirect. These tests run with a fresh
 * browser context (no session).
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Client route guard', () => {
  test('unauthenticated user on / is redirected to /login', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL((url) => url.pathname === '/login', { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('unauthenticated user accessing /login sees the login page', async ({ page }) => {
    await page.goto('/login');
    // Should stay on /login (no redirect to / or /setup since setup is complete
    // and we are not signed in).
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/login');
  });

  test('unauthenticated user on /setup (when setup is complete) redirects to /login', async ({ page }) => {
    await page.goto('/setup');
    await page.waitForURL((url) => url.pathname === '/login', { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('/api/setup/status is publicly accessible and reports completion', async ({ page }) => {
    const response = await page.request.get('/api/setup/status');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.needsSetup).toBe(false);
    expect(typeof body.passkeysEnabled).toBe('boolean');
  });
});

import { createTestUser, signInBrowserAsUser, deleteTestUser, type CreatedUser } from '../helpers/test-users';

test.describe('Client route guard — signed in', () => {
  let user: CreatedUser;

  test.beforeEach(async () => {
    user = await createTestUser('Route Guard Signed In');
  });

  test.afterEach(async () => {
    if (user) await deleteTestUser(user.id);
  });

  test('signed-in user visiting /login is redirected to /', async ({ page, context }) => {
    await signInBrowserAsUser(context, user.email, user.password);
    await page.goto('/login');
    // On mount, login.vue reads the session and redirects to /
    await page.waitForURL((url) => url.pathname === '/' || url.pathname === '', { timeout: 15_000 });
    await expect(page.locator('h1:has-text("Agentor")')).toBeVisible();
  });

  test('signed-in user visiting / renders the dashboard', async ({ page, context }) => {
    await signInBrowserAsUser(context, user.email, user.password);
    await page.goto('/');
    await expect(page.locator('h1:has-text("Agentor")')).toBeVisible({ timeout: 15_000 });
  });
});
