import { test, expect } from '@playwright/test';
import { goToDashboard, toggleSidebarSection } from '../helpers/ui-helpers';
import { createWorker, cleanupWorker, cleanupAllDomainMappings } from '../helpers/worker-lifecycle';
import { ApiClient } from '../helpers/api-client';

test.describe('Domain Mappings Panel — Advanced API', () => {
  test.afterEach(async ({ request }) => {
    await cleanupAllDomainMappings(request);
  });

  test('domain mapper status is displayed', async ({ request }) => {
    const api = new ApiClient(request);
    const { status, body } = await api.getDomainMapperStatus();
    expect(status).toBe(200);
    expect(typeof body.enabled).toBe('boolean');
  });

  test('domain mapping list shows entries from API', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body: statusBody } = await api.getDomainMapperStatus();

    if (!statusBody.enabled || statusBody.baseDomains.length === 0) {
      test.skip();
      return;
    }

    const container = await createWorker(request, { displayName: `DM-${Date.now()}` });

    try {
      const baseDomain = statusBody.baseDomains[0];
      await api.createDomainMapping({
        subdomain: `test-ui-${Date.now()}`,
        baseDomain,
        protocol: 'https',
        workerId: container.id,
        internalPort: 8080,
      });

      await goToDashboard(page);

      const { body: mappings } = await api.listDomainMappings();
      expect(mappings.length).toBeGreaterThan(0);
    } finally {
      await cleanupWorker(request, container.id);
    }
  });

  test('domain mapping CRUD via API', async ({ request }) => {
    const api = new ApiClient(request);
    const { body: statusBody } = await api.getDomainMapperStatus();

    if (!statusBody.enabled || statusBody.baseDomains.length === 0) {
      test.skip();
      return;
    }

    const container = await createWorker(request);

    try {
      const baseDomain = statusBody.baseDomains[0];

      const { status: createStatus, body: created } = await api.createDomainMapping({
        subdomain: `crud-${Date.now()}`,
        baseDomain,
        protocol: 'https',
        workerId: container.id,
        internalPort: 8080,
      });
      expect(createStatus).toBe(201);
      expect(created.id).toBeTruthy();

      const { body: list } = await api.listDomainMappings();
      const found = list.find((m: { id: string }) => m.id === created.id);
      expect(found).toBeTruthy();

      const { status: delStatus } = await api.deleteDomainMapping(created.id);
      expect(delStatus).toBe(200);

      const { body: afterDelete } = await api.listDomainMappings();
      const deletedItem = afterDelete.find((m: { id: string }) => m.id === created.id);
      expect(deletedItem).toBeFalsy();
    } finally {
      await cleanupWorker(request, container.id);
    }
  });

  test('HTTP mapping uses web entrypoint', async ({ request }) => {
    const api = new ApiClient(request);
    const { body: statusBody } = await api.getDomainMapperStatus();

    if (!statusBody.enabled || statusBody.baseDomains.length === 0) {
      test.skip();
      return;
    }

    const container = await createWorker(request);

    try {
      const { status, body } = await api.createDomainMapping({
        subdomain: `http-${Date.now()}`,
        baseDomain: statusBody.baseDomains[0],
        protocol: 'http',
        workerId: container.id,
        internalPort: 8080,
      });
      expect(status).toBe(201);
      expect(body.protocol).toBe('http');
    } finally {
      await cleanupWorker(request, container.id);
    }
  });

  test('delete non-existent domain mapping is idempotent', async ({ request }) => {
    const api = new ApiClient(request);
    const { status, body } = await api.deleteDomainMapping('non-existent-id');
    // Delete is idempotent per domain-mappings.spec.ts
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });
});

test.describe('Domain Mappings Panel — UI', () => {
  test('domain mappings section visible or hidden based on config', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();

    await goToDashboard(page);

    if (body.enabled) {
      await expect(page.locator('button:has-text("DOMAIN MAPPINGS")')).toBeVisible({ timeout: 10_000 });
    } else {
      await expect(page.locator('button:has-text("DOMAIN MAPPINGS")')).toBeHidden();
    }
  });

  test('+ Map button opens the form when enabled', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');

    await goToDashboard(page);
    const aside = page.locator('aside');
    await aside.locator('button:has-text("+ Map")').last().click();
    await expect(aside.locator('input[placeholder="subdomain"]')).toBeVisible({ timeout: 5_000 });
    await expect(aside.locator('input[placeholder="Internal port"]')).toBeVisible();
  });

  test('form has protocol selector', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');

    await goToDashboard(page);
    const aside = page.locator('aside');
    await aside.locator('button:has-text("+ Map")').last().click();
    // Protocol selector (select element) should be visible
    const protocolSelect = aside.locator('select').first();
    await expect(protocolSelect).toBeVisible({ timeout: 5_000 });
  });

  test('switching protocol to TCP hides Basic auth checkbox', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');

    await goToDashboard(page);
    const aside = page.locator('aside');
    await aside.locator('button:has-text("+ Map")').last().click();
    // Basic auth should be visible initially (http/https default)
    await expect(aside.locator('text=Basic auth')).toBeVisible({ timeout: 5_000 });
    // Switch protocol to TCP
    const protocolSelect = aside.locator('select').first();
    await protocolSelect.selectOption('tcp');
    // Basic auth should now be hidden
    await expect(aside.locator('text=Basic auth')).toBeHidden({ timeout: 5_000 });
  });

  test('switching protocol back from TCP restores Basic auth', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');

    await goToDashboard(page);
    const aside = page.locator('aside');
    await aside.locator('button:has-text("+ Map")').last().click();
    const protocolSelect = aside.locator('select').first();
    // Switch to TCP
    await protocolSelect.selectOption('tcp');
    await expect(aside.locator('text=Basic auth')).toBeHidden({ timeout: 5_000 });
    // Switch back to https
    await protocolSelect.selectOption('https');
    await expect(aside.locator('text=Basic auth')).toBeVisible({ timeout: 5_000 });
  });

  test('checking Basic auth reveals username and password fields', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');

    await goToDashboard(page);
    const aside = page.locator('aside');
    await aside.locator('button:has-text("+ Map")').last().click();
    // Username/password should be hidden initially
    await expect(aside.locator('input[placeholder="Username"]')).toBeHidden();
    // Check the Basic auth checkbox
    await aside.locator('text=Basic auth').click();
    // Fields should now be visible
    await expect(aside.locator('input[placeholder="Username"]')).toBeVisible({ timeout: 5_000 });
    await expect(aside.locator('input[placeholder="Password"]')).toBeVisible();
  });

  test('form shows base domain suffix', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');

    await goToDashboard(page);
    const aside = page.locator('aside');
    await aside.locator('button:has-text("+ Map")').last().click();
    // Should display the base domain (either as span or select)
    await expect(aside.locator(`text=.${body.baseDomains[0]}`)).toBeVisible({ timeout: 5_000 });
  });

  test('form shows base domain selector when multiple domains configured', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');
    test.skip(body.baseDomains.length < 2, 'Only one base domain configured');

    await goToDashboard(page);
    const aside = page.locator('aside');
    await aside.locator('button:has-text("+ Map")').last().click();
    // With multiple base domains, a select element should appear for domain choice
    const domainSelect = aside.locator('select').nth(1);
    await expect(domainSelect).toBeVisible({ timeout: 5_000 });
  });

  test('Cancel button closes the form', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');

    await goToDashboard(page);
    const aside = page.locator('aside');
    await aside.locator('button:has-text("+ Map")').last().click();
    await expect(aside.locator('input[placeholder="subdomain"]')).toBeVisible({ timeout: 5_000 });
    await aside.locator('button:has-text("Cancel")').click();
    await expect(aside.locator('input[placeholder="subdomain"]')).toBeHidden({ timeout: 5_000 });
  });
});
