import { test, expect } from '@playwright/test';
import { createTestUser, signInBrowserAsUser, deleteTestUser, type CreatedUser } from '../helpers/test-users';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Account modal — env vars', () => {
  let user: CreatedUser;

  test.beforeEach(async () => {
    user = await createTestUser('Env Vars UI');
  });

  test.afterEach(async () => {
    if (user) await deleteTestUser(user.id);
  });

  test('renders the API keys, custom env vars, and agent credentials sections', async ({ page, context }) => {
    await signInBrowserAsUser(context, user.email, user.password);
    await page.goto('/');
    await page.waitForSelector('h1:has-text("Agentor")', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Account settings' }).click();

    await expect(page.getByRole('heading', { name: 'API keys & tokens' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Custom environment variables' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Agent OAuth credentials' })).toBeVisible();
  });

  test('saves an API key and persists across reload of the modal', async ({ page, context }) => {
    await signInBrowserAsUser(context, user.email, user.password);
    await page.goto('/');
    await page.waitForSelector('h1:has-text("Agentor")', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Account settings' }).click();

    const tokenValue = `gh-ui-${Date.now()}`;
    const ghInput = page.getByLabel('GitHub token', { exact: true });
    await ghInput.fill(tokenValue);
    await page.locator('[data-testid="env-save"]').click();
    await expect(page.locator('[data-testid="env-success"]')).toBeVisible({ timeout: 10_000 });

    // Close + reopen — the value should be preserved.
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Account settings' }).click();
    await expect(page.getByLabel('GitHub token', { exact: true })).toHaveValue(tokenValue);
  });

  test('adds and removes a custom env var row', async ({ page, context }) => {
    await signInBrowserAsUser(context, user.email, user.password);
    await page.goto('/');
    await page.waitForSelector('h1:has-text("Agentor")', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Account settings' }).click();

    const customSection = page.locator('[data-testid="account-custom-env-vars"]');
    await customSection.getByRole('button', { name: 'Add' }).click();

    const keyInput = customSection.locator('[data-testid="custom-env-key"]').first();
    const valueInput = customSection.locator('[data-testid="custom-env-value"]').first();
    await keyInput.fill('AGENTOR_UI_TEST');
    await valueInput.fill('hello');
    await page.locator('[data-testid="env-save"]').click();
    await expect(page.locator('[data-testid="env-success"]')).toBeVisible({ timeout: 10_000 });

    // Reload the modal and check value persisted.
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Account settings' }).click();
    const reloadedKey = customSection.locator('[data-testid="custom-env-key"]').first();
    await expect(reloadedKey).toHaveValue('AGENTOR_UI_TEST');
  });

  test('rejects invalid custom env var key with an inline error', async ({ page, context }) => {
    await signInBrowserAsUser(context, user.email, user.password);
    await page.goto('/');
    await page.waitForSelector('h1:has-text("Agentor")', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Account settings' }).click();

    const customSection = page.locator('[data-testid="account-custom-env-vars"]');
    await customSection.getByRole('button', { name: 'Add' }).click();
    await customSection.locator('[data-testid="custom-env-key"]').first().fill('badKey');
    await customSection.locator('[data-testid="custom-env-value"]').first().fill('x');
    await page.locator('[data-testid="env-save"]').click();
    await expect(page.locator('[data-testid="env-error"]')).toBeVisible({ timeout: 5_000 });
  });

  test('agent credentials section lists all 3 agents as not logged in for a fresh user', async ({ page, context }) => {
    await signInBrowserAsUser(context, user.email, user.password);
    await page.goto('/');
    await page.waitForSelector('h1:has-text("Agentor")', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Account settings' }).click();

    const claude = page.locator('[data-testid="agent-cred-claude"]');
    const codex = page.locator('[data-testid="agent-cred-codex"]');
    const gemini = page.locator('[data-testid="agent-cred-gemini"]');

    await expect(claude).toBeVisible();
    await expect(codex).toBeVisible();
    await expect(gemini).toBeVisible();
    await expect(claude).toContainText(/Not logged in/i);
    await expect(codex).toContainText(/Not logged in/i);
    await expect(gemini).toContainText(/Not logged in/i);
  });
});
