import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createTestUser, deleteTestUser, signInBrowserAsUser, signedInContext, type CreatedUser } from '../helpers/test-users';
import { openCreateWorkerModal } from '../helpers/ui-helpers';

// Repo picker + Account modal with a self-managed GitLab: the dockerized stack
// configures GITLAB_INSTANCES=mock=http://gitlab-mock:8080 (provider
// `gitlab-mock`, token variable GITLAB_MOCK_TOKEN) backed by a GitLab mock.
const MOCK = 'gitlab-mock';
const MOCK_TOKEN = 'glpat-agentor-mock-token';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('GitLab repositories in the dashboard', () => {
  let mockConfigured = false;
  let user: CreatedUser;

  test.beforeAll(async () => {
    user = await createTestUser('GitLab UI');
    const ctx = await signedInContext(user.email, user.password);
    try {
      const api = new ApiClient(ctx);
      mockConfigured = (await api.listGitProviders()).body.some((p: { id: string }) => p.id === MOCK);
      if (mockConfigured) {
        expect((await api.putAccountEnvVars({ envVars: [{ key: 'GITLAB_MOCK_TOKEN', value: MOCK_TOKEN }] })).status).toBe(200);
      }
    } finally {
      await ctx.dispose();
    }
  });

  test.afterAll(async () => {
    if (user) await deleteTestUser(user.id);
  });

  test.beforeEach(() => {
    test.skip(!mockConfigured, 'needs GITLAB_INSTANCES=mock=… (dockerized test stack)');
  });

  async function openDashboard(page: Page, context: BrowserContext) {
    await signInBrowserAsUser(context, user.email, user.password);
    await page.goto('/');
    await page.waitForSelector('h1:has-text("Agentor")', { timeout: 15_000 });
  }

  async function addGitLabRepoRow(page: Page) {
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByRole('button', { name: '+ Add repository' }).click();
    await dialog.getByRole('combobox', { name: 'Git provider' }).click();
    await page.getByRole('option', { name: 'GitLab (mock)' }).click();
    return dialog;
  }

  test('the provider select lists GitHub, GitLab and the self-managed instance', async ({ page, context }) => {
    await openDashboard(page, context);
    await openCreateWorkerModal(page);
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByRole('button', { name: '+ Add repository' }).click();
    await dialog.getByRole('combobox', { name: 'Git provider' }).click();
    for (const name of ['GitHub', 'GitLab', 'GitLab (mock)']) {
      await expect(page.getByRole('option', { name, exact: true })).toBeVisible();
    }
  });

  test('searching and picking a nested project loads its branches', async ({ page, context }) => {
    await openDashboard(page, context);
    const dialog = await addGitLabRepoRow(page);

    // The token unlocks the searchable picker (instead of a plain URL input).
    const repoInput = dialog.getByRole('textbox', { name: 'Repository' });
    await repoInput.click();
    for (const fullName of ['group/sub/project', 'group/public-proj', 'mock-user/personal']) {
      await expect(dialog.getByRole('button', { name: fullName })).toBeVisible();
    }

    await repoInput.fill('sub/proj');
    await expect(dialog.getByRole('button', { name: 'group/public-proj' })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'group/sub/project' }).click();
    await expect(repoInput).toHaveValue('group/sub/project');

    const branch = dialog.getByRole('combobox', { name: 'Branch' });
    await expect(branch).toHaveAttribute('placeholder', 'main (default)', { timeout: 15_000 });
    await branch.fill('feat');
    await expect(page.getByRole('option', { name: 'feature-x' })).toBeVisible();
  });

  test('offers to create a project under a nested group path', async ({ page, context }) => {
    await openDashboard(page, context);
    const dialog = await addGitLabRepoRow(page);
    const repoInput = dialog.getByRole('textbox', { name: 'Repository' });
    await repoInput.click();
    await repoInput.fill('group/sub/brand-new');
    await expect(dialog.getByRole('button', { name: /Create group\/sub\/brand-new\s+public/ })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Create group\/sub\/brand-new\s+private/ })).toBeVisible();
  });

  test('the Account modal has a token input per GitLab provider', async ({ page, context }) => {
    await openDashboard(page, context);
    await page.getByRole('button', { name: 'Account settings' }).click();
    const section = page.locator('[data-testid="account-api-keys"]');
    await expect(section.locator('[data-testid="env-GITLAB_TOKEN"]')).toBeVisible();
    // The instance's token variable is a predefined slot (not a custom row),
    // pre-filled with the saved value and labelled with its provider.
    await expect(section.locator('[data-testid="env-GITLAB_MOCK_TOKEN"]')).toHaveValue(MOCK_TOKEN, { timeout: 10_000 });
    await expect(section.getByText('GitLab (mock) token')).toBeVisible();
  });
});
