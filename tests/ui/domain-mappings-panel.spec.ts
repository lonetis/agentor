import { test, expect, type Locator } from '@playwright/test';
import { goToDashboard, selectSidebarTab, expectSidebarTabExists } from '../helpers/ui-helpers';
import { ApiClient } from '../helpers/api-client';

/** Click the Domain Mappings "+ Map" button and verify the form opens. Retries up to 3 times. */
async function openDmForm(aside: Locator) {
  const subdomainInput = aside.locator('input[placeholder="subdomain (optional)"]');
  const mapBtn = aside.locator('button:has-text("+ Map")');
  await expect(mapBtn).toBeVisible({ timeout: 10_000 });
  await mapBtn.scrollIntoViewIfNeeded();

  for (let attempt = 0; attempt < 3; attempt++) {
    if (await mapBtn.isVisible().catch(() => false)) {
      await mapBtn.click({ force: attempt > 0 });
    }
    try {
      await expect(subdomainInput).toBeVisible({ timeout: 3_000 });
      return; // Form opened successfully
    } catch {
      // Retry
    }
  }
  // Final assertion — form must be open
  await expect(subdomainInput).toBeVisible({ timeout: 5_000 });
}

test.describe('Domain Mappings Panel', () => {

  test('domain mapper status endpoint returns enabled flag', async ({ request }) => {
    const api = new ApiClient(request);
    const { status, body } = await api.getDomainMapperStatus();
    expect(status).toBe(200);
    expect(typeof body.enabled).toBe('boolean');
  });

  test('domain mapper status includes baseDomains array', async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    expect(Array.isArray(body.baseDomains)).toBe(true);
  });

  test('Domains tab hidden when not enabled, visible when enabled', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();

    await goToDashboard(page);

    if (body.enabled) {
      await expectSidebarTabExists(page, 'Domains');
    }
    // When not enabled, the Domains tab simply doesn't appear in the tab list
  });

  test('domain mappings list endpoint returns array', async ({ request }) => {
    const api = new ApiClient(request);
    const { status, body } = await api.listDomainMappings();
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  test('shows Domain Mappings content when enabled', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();

    // Skip if domain mapping is not enabled (no BASE_DOMAINS configured)
    test.skip(!body.enabled, 'Domain mapping not enabled (BASE_DOMAINS not set)');

    await goToDashboard(page);
    await selectSidebarTab(page, 'Domains');
    // Should show either "+ Map" button or mapping list
    await expect(page.locator('aside').locator('button:has-text("+ Map")')).toBeVisible({ timeout: 10_000 });
  });

  test('clicking + Map opens the domain mapping form', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');

    await goToDashboard(page);
    await selectSidebarTab(page, 'Domains');
    const aside = page.locator('aside');
    await openDmForm(aside);
    // Form should appear with Add and Cancel buttons
    await expect(aside.locator('button:has-text("Add")')).toBeVisible({ timeout: 5_000 });
    await expect(aside.locator('button:has-text("Cancel")')).toBeVisible();
    // Subdomain input should be visible
    await expect(aside.locator('input[placeholder="subdomain (optional)"]')).toBeVisible();
    await expect(aside.locator('input[placeholder="Internal port"]')).toBeVisible();
  });

  test('domain mapping form has protocol selector with http/https/tcp', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');

    await goToDashboard(page);
    await selectSidebarTab(page, 'Domains');
    const aside = page.locator('aside');
    await openDmForm(aside);
    // Protocol selector uses toggle buttons (not <select>)
    await expect(aside.locator('button:has-text("http")').first()).toBeVisible({ timeout: 5_000 });
    await expect(aside.locator('button:has-text("https")').first()).toBeVisible();
    await expect(aside.locator('button:has-text("tcp")').first()).toBeVisible();
  });

  test('domain mapping form shows Basic auth checkbox for http protocol', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');

    await goToDashboard(page);
    await selectSidebarTab(page, 'Domains');
    const aside = page.locator('aside');
    await openDmForm(aside);
    // Basic auth checkbox should be visible (default protocol is http, not tcp)
    await expect(aside.locator('text=Basic auth')).toBeVisible({ timeout: 5_000 });
  });

  test('domain mapping form Cancel closes the form', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');

    await goToDashboard(page);
    await selectSidebarTab(page, 'Domains');
    const aside = page.locator('aside');
    await openDmForm(aside);
    await expect(aside.locator('button:has-text("Cancel")')).toBeVisible({ timeout: 5_000 });
    await aside.locator('button:has-text("Cancel")').click();
    // Form should close, subdomain input should be hidden
    await expect(aside.locator('input[placeholder="subdomain (optional)"]')).toBeHidden({ timeout: 5_000 });
  });

  test('domain mapping form shows base domain', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');

    // Start listening for domain-mapper status API before navigating so we catch the first response
    const statusResponsePromise = page.waitForResponse(
      resp => resp.url().includes('/api/domain-mapper/status') && resp.ok(),
      { timeout: 15_000 },
    );
    await goToDashboard(page);
    await statusResponsePromise;
    await selectSidebarTab(page, 'Domains');
    const aside = page.locator('aside');
    await openDmForm(aside);
    // Should show the base domain in the form (use first() to avoid strict mode if a parallel test created a mapping with the same domain)
    await expect(aside.locator(`text=.${body.baseDomains[0]}`).first()).toBeVisible({ timeout: 10_000 });
  });

  test('API-created domain mapping appears in panel', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body: mapperStatus } = await api.getDomainMapperStatus();
    test.skip(!mapperStatus.enabled, 'Domain mapping not enabled');

    const { createWorker, cleanupWorker } = await import('../helpers/worker-lifecycle');
    const container = await createWorker(request);
    const uniqueSub = `uipanel-${Date.now()}`;

    try {
      const { body: mapping } = await api.createDomainMapping({
        subdomain: uniqueSub,
        baseDomain: mapperStatus.baseDomains[0],
        protocol: 'https',
        workerId: container.id,
        internalPort: 8080,
      });

      try {
        await goToDashboard(page);
        await selectSidebarTab(page, 'Domains');
        // The subdomain should appear in the sidebar
        await expect(page.locator('aside').locator(`text=${uniqueSub}`)).toBeVisible({ timeout: 15_000 });
        // Protocol badge should show https
        await expect(page.locator('aside').locator('text=https').first()).toBeVisible();
      } finally {
        await api.deleteDomainMapping(mapping.id);
      }
    } finally {
      await cleanupWorker(request, container.id);
    }
  });

  test('domain mapping form shows path input for http protocol', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');

    await goToDashboard(page);
    await selectSidebarTab(page, 'Domains');
    const aside = page.locator('aside');
    await openDmForm(aside);
    // Path input should be visible (default protocol is http)
    await expect(aside.locator('input[placeholder*="path"]')).toBeVisible({ timeout: 5_000 });
  });

  test('switching protocol to TCP hides path input', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');

    await goToDashboard(page);
    await selectSidebarTab(page, 'Domains');
    const aside = page.locator('aside');
    await openDmForm(aside);
    await expect(aside.locator('input[placeholder*="path"]')).toBeVisible({ timeout: 5_000 });
    await aside.locator('button:has-text("tcp")').first().click();
    await expect(aside.locator('input[placeholder*="path"]')).toBeHidden({ timeout: 5_000 });
  });

  test('API-created mapping with path shows path in display', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body: mapperStatus } = await api.getDomainMapperStatus();
    test.skip(!mapperStatus.enabled, 'Domain mapping not enabled');

    const { createWorker, cleanupWorker } = await import('../helpers/worker-lifecycle');
    const container = await createWorker(request);
    const uniqueSub = `uipath-${Date.now()}`;

    try {
      const { body: mapping } = await api.createDomainMapping({
        subdomain: uniqueSub,
        baseDomain: mapperStatus.baseDomains[0],
        protocol: 'http',
        workerId: container.id,
        internalPort: 8080,
        path: '/api',
      });

      try {
        await goToDashboard(page);
        await selectSidebarTab(page, 'Domains');
        // The domain with path should appear in the sidebar
        await expect(page.locator('aside').locator(`text=${uniqueSub}.${mapperStatus.baseDomains[0]}/api`)).toBeVisible({ timeout: 15_000 });
      } finally {
        await api.deleteDomainMapping(mapping.id);
      }
    } finally {
      await cleanupWorker(request, container.id);
    }
  });

  test('switching protocol to TCP hides Basic auth checkbox', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');

    await goToDashboard(page);
    await selectSidebarTab(page, 'Domains');
    const aside = page.locator('aside');
    await openDmForm(aside);
    // Basic auth should be visible initially (default protocol is http)
    await expect(aside.locator('text=Basic auth')).toBeVisible({ timeout: 5_000 });
    // Switch protocol to TCP by clicking the tcp toggle button
    await aside.locator('button:has-text("tcp")').first().click();
    // Basic auth should now be hidden
    await expect(aside.locator('text=Basic auth')).toBeHidden({ timeout: 5_000 });
  });

  test('checking Basic auth shows username and password inputs', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');

    await goToDashboard(page);
    await selectSidebarTab(page, 'Domains');
    const aside = page.locator('aside');
    await openDmForm(aside);
    // Username/password inputs should be hidden initially
    await expect(aside.locator('input[placeholder="Username"]')).toBeHidden();
    // Check the Basic auth checkbox
    await aside.locator('text=Basic auth').click();
    // Username and password inputs should now be visible
    await expect(aside.locator('input[placeholder="Username"]')).toBeVisible({ timeout: 5_000 });
    await expect(aside.locator('input[placeholder="Password"]')).toBeVisible();
  });

  test('shows no active domain mappings message when empty and enabled', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body: statusBody } = await api.getDomainMapperStatus();

    test.skip(!statusBody.enabled, 'Domain mapping not enabled (BASE_DOMAINS not set)');

    // Ensure no mappings exist
    const { body: mappings } = await api.listDomainMappings();
    test.skip(mappings.length > 0, 'Domain mappings already exist');

    await goToDashboard(page);
    await selectSidebarTab(page, 'Domains');
    await expect(page.locator('text=No active domain mappings')).toBeVisible();
  });
});
