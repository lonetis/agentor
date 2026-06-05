import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { createTestUser, signInBrowserAsUser, deleteTestUser, type CreatedUser } from '../helpers/test-users';

test.use({ storageState: { cookies: [], origins: [] } });

// The five predefined env var slots rendered by the Account modal. These mirror
// PREDEFINED_ENV_VAR_KEYS in orchestrator/shared/types.ts — each is rendered as a
// masked input labeled by the KEY itself, addressable via `env-<KEY>`.
const PREDEFINED_KEYS = [
  'GITHUB_TOKEN',
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
] as const;

test.describe('Account modal — env vars', () => {
  let user: CreatedUser;

  test.beforeEach(async () => {
    user = await createTestUser('Env Vars UI');
  });

  test.afterEach(async () => {
    if (user) await deleteTestUser(user.id);
  });

  /**
   * Sign in as the fresh test user, load the dashboard, and open the Account modal
   * via the user-info button in the sidebar footer (aria-label "Account settings").
   */
  async function openAccountModal(page: Page, context: BrowserContext) {
    await signInBrowserAsUser(context, user.email, user.password);
    await page.goto('/');
    await page.waitForSelector('h1:has-text("Agentor")', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Account settings' }).click();
  }

  test('renders the predefined, custom, SSH, and agent credentials sections', async ({ page, context }) => {
    await openAccountModal(page, context);

    const predefined = page.locator('[data-testid="account-api-keys"]');
    const custom = page.locator('[data-testid="account-custom-env-vars"]');
    const ssh = page.locator('[data-testid="account-ssh"]');

    await expect(predefined).toBeVisible();
    await expect(custom).toBeVisible();
    await expect(ssh).toBeVisible();

    // Predefined section renders the section heading and one masked input per
    // predefined key, each addressable by `env-<KEY>` with its label equal to the
    // env var NAME (not a friendly label).
    await expect(predefined.getByRole('heading', { name: 'Predefined environment variables' })).toBeVisible();
    for (const key of PREDEFINED_KEYS) {
      await expect(page.locator(`[data-testid="env-${key}"]`)).toBeVisible();
      await expect(predefined.getByText(key, { exact: true })).toBeVisible();
    }

    // Agent OAuth credentials section: 3 agents, all "Not logged in" for a fresh user.
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

  test('saves a predefined env var and persists across reload of the modal', async ({ page, context }) => {
    await openAccountModal(page, context);

    const tokenValue = `gh-ui-${Date.now()}`;
    await page.locator('[data-testid="env-GITHUB_TOKEN"]').fill(tokenValue);
    await page.locator('[data-testid="env-save"]').click();
    await expect(page.locator('[data-testid="env-success"]')).toBeVisible({ timeout: 10_000 });

    // Close + reload the page, then reopen — the value should be preserved.
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.reload();
    await page.waitForSelector('h1:has-text("Agentor")', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Account settings' }).click();
    await expect(page.locator('[data-testid="env-GITHUB_TOKEN"]')).toHaveValue(tokenValue);
  });

  test('adds a custom env var that persists across reload of the modal', async ({ page, context }) => {
    await openAccountModal(page, context);

    const customSection = page.locator('[data-testid="account-custom-env-vars"]');
    const customKey = `AGENTOR_UI_${Date.now()}`;
    await customSection.getByRole('button', { name: 'Add' }).click();
    await customSection.locator('[data-testid="custom-env-key"]').first().fill(customKey);
    await customSection.locator('[data-testid="custom-env-value"]').first().fill('hello');
    await page.locator('[data-testid="env-save"]').click();
    await expect(page.locator('[data-testid="env-success"]')).toBeVisible({ timeout: 10_000 });

    // Close + reload, then reopen — the custom row should be restored.
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.reload();
    await page.waitForSelector('h1:has-text("Agentor")', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Account settings' }).click();
    await expect(
      customSection.locator('[data-testid="custom-env-key"]').first(),
    ).toHaveValue(customKey, { timeout: 10_000 });
  });

  test('rejects an invalid custom env var key with an inline error', async ({ page, context }) => {
    await openAccountModal(page, context);

    const customSection = page.locator('[data-testid="account-custom-env-vars"]');
    await customSection.getByRole('button', { name: 'Add' }).click();
    await customSection.locator('[data-testid="custom-env-key"]').first().fill('badKey');
    await customSection.locator('[data-testid="custom-env-value"]').first().fill('x');
    await page.locator('[data-testid="env-save"]').click();
    // Server returns 400 for a lowercase key — surfaced inline.
    await expect(page.locator('[data-testid="env-error"]')).toBeVisible({ timeout: 5_000 });
  });

  test('saves the SSH public key via its own button and persists across reload', async ({ page, context }) => {
    await openAccountModal(page, context);

    const keyValue = `ssh-ed25519 AAAA-ui-${Date.now()} x@h`;
    await page.locator('[data-testid="env-sshPublicKey"]').fill(keyValue);
    // The SSH key has its OWN save button + endpoint — NOT the env-vars save.
    await page.locator('[data-testid="env-save-ssh"]').click();
    await expect(page.locator('[data-testid="ssh-success"]')).toBeVisible({ timeout: 10_000 });

    // Close + reload, then reopen — the textarea value should be preserved.
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.reload();
    await page.waitForSelector('h1:has-text("Agentor")', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Account settings' }).click();
    await expect(page.locator('[data-testid="env-sshPublicKey"]')).toHaveValue(keyValue);
  });
});
