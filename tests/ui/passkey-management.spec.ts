import { test, expect } from '@playwright/test';
import { installVirtualAuthenticator } from '../helpers/webauthn';
import { createTestUser, signInBrowserAsUser, deleteTestUser, type CreatedUser } from '../helpers/test-users';

// Passkey tests must run against the Traefik-terminated HTTPS origin, not
// against `http://localhost:3000` — WebAuthn binds credentials to the exact
// origin the browser is on, and the server's passkey plugin is configured
// with `rpID = dash.docker.localhost` + `origin = https://dash.docker.localhost`.
// A request to `localhost:3000` would hit the orchestrator but the browser's
// rpID computation would reject the ceremony.
const TRAEFIK_URL = 'https://dash.docker.localhost';

test.use({
  baseURL: TRAEFIK_URL,
  // Self-signed cert on the test stack — the CA isn't installed in chromium's
  // trust store, so we tell Playwright to skip verification.
  ignoreHTTPSErrors: true,
  // Fresh browser context per test: each test signs in as its own user.
  // The virtual WebAuthn authenticator is scoped to the page, so passkeys
  // created during the test only persist for the duration of the page.
  storageState: { cookies: [], origins: [] },
});

test.describe('Passkey management', () => {
  let user: CreatedUser;

  test.beforeEach(async () => {
    user = await createTestUser('Passkey Manager');
  });

  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  test('user with password can register a passkey via the account modal', async ({ page, context }) => {
    await signInBrowserAsUser(context, user.email, user.password, TRAEFIK_URL);

    const auth = await installVirtualAuthenticator(page);
    try {
      await page.goto('/');
      await page.waitForSelector('h1:has-text("Agentor")', { timeout: 15_000 });

      // Open the account modal by clicking the user info in the sidebar footer.
      await page.getByRole('button', { name: 'Account settings' }).click();
      await expect(page.getByRole('heading', { name: 'Account settings' })).toBeVisible();

      // Add a passkey.
      const passkeyName = 'My Test Passkey';
      await page.getByLabel('Name (optional)').fill(passkeyName);
      await page.getByRole('button', { name: 'Add passkey' }).click();

      // Wait for the success message and the passkey list entry.
      await expect(page.getByText('Passkey added', { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('text=' + passkeyName)).toBeVisible();

      // The virtual authenticator should now hold one credential.
      const credentials = await auth.listCredentials();
      expect(credentials.length).toBe(1);
    } finally {
      await auth.dispose();
    }
  });

  test('user can sign in with a registered passkey', async ({ page, context }) => {
    // Same browser context, same virtual authenticator across two phases.
    const auth = await installVirtualAuthenticator(page);
    try {
      // Phase 1: sign in with password, register a passkey, sign out.
      await signInBrowserAsUser(context, user.email, user.password, TRAEFIK_URL);
      await page.goto('/');
      await page.waitForSelector('h1:has-text("Agentor")', { timeout: 15_000 });

      await page.getByRole('button', { name: 'Account settings' }).click();
      await page.getByRole('button', { name: 'Add passkey' }).click();
      await expect(page.getByText('Passkey added', { exact: true })).toBeVisible({ timeout: 15_000 });
      // Close modal
      await page.getByRole('button', { name: 'Close' }).first().click();

      // Sign out via the sidebar footer
      await page.getByRole('button', { name: 'Sign out' }).click();
      await page.waitForURL((url) => url.pathname === '/login', { timeout: 10_000 });

      // Phase 2: sign in with passkey
      await page.getByRole('button', { name: 'Sign in with passkey' }).click();
      // Should land on dashboard
      await page.waitForURL((url) => url.pathname === '/' || url.pathname === '', { timeout: 20_000 });
      await expect(page.locator('h1:has-text("Agentor")')).toBeVisible({ timeout: 15_000 });
    } finally {
      await auth.dispose();
    }
  });

  test('user can remove their password after registering a passkey', async ({ page, context }) => {
    const auth = await installVirtualAuthenticator(page);
    try {
      await signInBrowserAsUser(context, user.email, user.password, TRAEFIK_URL);
      await page.goto('/');
      await page.waitForSelector('h1:has-text("Agentor")', { timeout: 15_000 });
      await page.getByRole('button', { name: 'Account settings' }).click();

      // Add a passkey first
      await page.getByRole('button', { name: 'Add passkey' }).click();
      await expect(page.getByText('Passkey added', { exact: true })).toBeVisible({ timeout: 15_000 });

      // Two-step confirmation: click "Remove password", then "Confirm remove"
      await page.getByRole('button', { name: 'Remove password' }).click();
      await page.getByRole('button', { name: 'Confirm remove' }).click();
      await expect(page.getByText('Password removed', { exact: true })).toBeVisible({ timeout: 15_000 });
    } finally {
      await auth.dispose();
    }
  });

  test('user without password cannot remove their last passkey', async ({ page, context }) => {
    const auth = await installVirtualAuthenticator(page);
    try {
      await signInBrowserAsUser(context, user.email, user.password, TRAEFIK_URL);
      await page.goto('/');
      await page.waitForSelector('h1:has-text("Agentor")', { timeout: 15_000 });
      await page.getByRole('button', { name: 'Account settings' }).click();

      // Add a passkey
      await page.getByRole('button', { name: 'Add passkey' }).click();
      await expect(page.getByText('Passkey added', { exact: true })).toBeVisible({ timeout: 15_000 });

      // Remove the password (two-step)
      await page.getByRole('button', { name: 'Remove password' }).click();
      await page.getByRole('button', { name: 'Confirm remove' }).click();
      await expect(page.getByText('Password removed', { exact: true })).toBeVisible({ timeout: 15_000 });

      // Now the only passkey's Remove button should be disabled
      const removePasskeyBtn = page.locator('button:has-text("Remove")').last();
      await expect(removePasskeyBtn).toBeDisabled();
    } finally {
      await auth.dispose();
    }
  });

  test('user without password can set a new password', async ({ page, context }) => {
    const auth = await installVirtualAuthenticator(page);
    try {
      await signInBrowserAsUser(context, user.email, user.password, TRAEFIK_URL);
      await page.goto('/');
      await page.waitForSelector('h1:has-text("Agentor")', { timeout: 15_000 });
      await page.getByRole('button', { name: 'Account settings' }).click();

      // Register a passkey, then remove the password
      await page.getByRole('button', { name: 'Add passkey' }).click();
      await expect(page.getByText('Passkey added', { exact: true })).toBeVisible({ timeout: 15_000 });
      await page.getByRole('button', { name: 'Remove password' }).click();
      await page.getByRole('button', { name: 'Confirm remove' }).click();
      await expect(page.getByText('Password removed', { exact: true })).toBeVisible({ timeout: 15_000 });

      // The Password section heading should now read "Set a password" and
      // there should be no "Current password" field.
      await expect(page.getByRole('heading', { name: 'Set a password' })).toBeVisible();
      await expect(page.getByLabel('Current password', { exact: true })).toHaveCount(0);

      // Set a new password
      const newPass = 'brand-new-pass-12345';
      await page.getByLabel('New password', { exact: true }).fill(newPass);
      await page.getByLabel('Confirm new password', { exact: true }).fill(newPass);
      await page.getByRole('button', { name: 'Set password' }).click();
      await expect(page.getByText('Password set', { exact: true })).toBeVisible({ timeout: 15_000 });
    } finally {
      await auth.dispose();
    }
  });
});
