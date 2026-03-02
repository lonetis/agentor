import { test, expect } from '@playwright/test';
import { goToDashboard } from '../helpers/ui-helpers';
import { ApiClient } from '../helpers/api-client';

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

  test('Domain Mappings section hidden when not enabled', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();

    await goToDashboard(page);

    if (!body.enabled) {
      // When domain mapping is not enabled, the section should not be rendered
      await expect(page.locator('button:has-text("DOMAIN MAPPINGS")')).toBeHidden();
    } else {
      // When enabled, section should be visible
      await expect(page.locator('button:has-text("DOMAIN MAPPINGS")')).toBeVisible();
    }
  });

  test('domain mappings list endpoint returns array', async ({ request }) => {
    const api = new ApiClient(request);
    const { status, body } = await api.listDomainMappings();
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  test('shows Domain Mappings section when enabled', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();

    // Skip if domain mapping is not enabled (no BASE_DOMAINS configured)
    test.skip(!body.enabled, 'Domain mapping not enabled (BASE_DOMAINS not set)');

    await goToDashboard(page);
    await expect(page.locator('button:has-text("DOMAIN MAPPINGS")')).toBeVisible();
  });

  test('clicking + Map opens the domain mapping form', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');

    await goToDashboard(page);
    const aside = page.locator('aside');
    await aside.locator('button:has-text("+ Map")').last().click();
    // Form should appear with Add and Cancel buttons
    await expect(aside.locator('button:has-text("Add")')).toBeVisible({ timeout: 5_000 });
    await expect(aside.locator('button:has-text("Cancel")')).toBeVisible();
    // Subdomain input should be visible
    await expect(aside.locator('input[placeholder="subdomain"]')).toBeVisible();
    await expect(aside.locator('input[placeholder="Internal port"]')).toBeVisible();
  });

  test('domain mapping form has protocol selector with http/https/tcp', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');

    await goToDashboard(page);
    const aside = page.locator('aside');
    await aside.locator('button:has-text("+ Map")').last().click();
    // Protocol selector should have 3 options
    const protocolSelect = aside.locator('select').last().locator('..').locator('select').first();
    await expect(protocolSelect).toBeVisible({ timeout: 5_000 });
  });

  test('domain mapping form shows Basic auth checkbox for http protocol', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');

    await goToDashboard(page);
    const aside = page.locator('aside');
    await aside.locator('button:has-text("+ Map")').last().click();
    // Basic auth checkbox should be visible (default protocol is http, not tcp)
    await expect(aside.locator('text=Basic auth')).toBeVisible({ timeout: 5_000 });
  });

  test('domain mapping form Cancel closes the form', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');

    await goToDashboard(page);
    const aside = page.locator('aside');
    await aside.locator('button:has-text("+ Map")').last().click();
    await expect(aside.locator('button:has-text("Cancel")')).toBeVisible({ timeout: 5_000 });
    await aside.locator('button:has-text("Cancel")').click();
    // Form should close, subdomain input should be hidden
    await expect(aside.locator('input[placeholder="subdomain"]')).toBeHidden({ timeout: 5_000 });
  });

  test('domain mapping form shows base domain', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');

    await goToDashboard(page);
    const aside = page.locator('aside');
    await aside.locator('button:has-text("+ Map")').last().click();
    // Should show the base domain (either as select or span)
    await expect(aside.locator(`text=.${body.baseDomains[0]}`)).toBeVisible({ timeout: 5_000 });
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

  test('switching protocol to TCP hides Basic auth checkbox', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');

    await goToDashboard(page);
    const aside = page.locator('aside');
    await aside.locator('button:has-text("+ Map")').last().click();
    // Basic auth should be visible initially (default protocol is http/https)
    await expect(aside.locator('text=Basic auth')).toBeVisible({ timeout: 5_000 });
    // Switch protocol to TCP
    const protocolSelect = aside.locator('select').first();
    await protocolSelect.selectOption('tcp');
    // Basic auth should now be hidden
    await expect(aside.locator('text=Basic auth')).toBeHidden({ timeout: 5_000 });
  });

  test('checking Basic auth shows username and password inputs', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');

    await goToDashboard(page);
    const aside = page.locator('aside');
    await aside.locator('button:has-text("+ Map")').last().click();
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
    await expect(page.locator('text=No active domain mappings')).toBeVisible();
  });
});
