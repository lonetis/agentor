import { test, expect } from '@playwright/test';
import { goToDashboard } from '../helpers/ui-helpers';

// Regression for the bug where the repo autocomplete never lit up after saving a
// GitHub token: useGitProviders fetched /api/git-providers once and was never
// refreshed, so `tokenConfigured` stayed stale until a full reload. Saving env
// vars must now refetch the provider list.
test.describe('GitHub provider refresh after saving env vars', () => {
  test('saving env vars in the Account modal refetches git providers', async ({ page }) => {
    // Stub the env-vars PUT so the test never mutates real account state.
    await page.route('**/api/account/env-vars', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            userId: 'test',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            envVars: [],
          }),
        });
      } else {
        await route.continue();
      }
    });

    await goToDashboard(page);

    // Open the Account modal from the sidebar footer.
    await page.click('button[aria-label="Account settings"]');
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // Arm a watcher for the provider refetch BEFORE clicking save (the initial
    // page-load fetch already happened, so this captures the refresh).
    const providersRefetch = page.waitForRequest(
      (req) => req.url().includes('/api/git-providers') && req.method() === 'GET',
      { timeout: 10_000 },
    );

    await dialog.locator('[data-testid="env-save"]').click();
    await providersRefetch; // throws if the refresh never fires
  });
});
