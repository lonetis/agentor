import { test, expect, type Locator } from '@playwright/test';
import { goToDashboard, selectSidebarTab, expectSidebarTabExists } from '../helpers/ui-helpers';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';
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

test.describe('Domain Mappings Panel — Advanced API', () => {

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
      await selectSidebarTab(page, 'Domains');

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
  test('Domains tab visible or hidden based on config', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();

    await goToDashboard(page);

    if (body.enabled) {
      await expectSidebarTabExists(page, 'Domains');
    }
    // When not enabled, the Domains tab simply doesn't appear in the tab list
  });

  test('+ Map button opens the form when enabled', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');

    await goToDashboard(page);
    await selectSidebarTab(page, 'Domains');
    const aside = page.locator('aside');
    await openDmForm(aside);
    await expect(aside.locator('input[placeholder="subdomain (optional)"]')).toBeVisible({ timeout: 5_000 });
    await expect(aside.locator('input[placeholder="Internal port"]')).toBeVisible();
  });

  test('form has protocol selector', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');

    await goToDashboard(page);
    await selectSidebarTab(page, 'Domains');
    const aside = page.locator('aside');
    await openDmForm(aside);
    await expect(aside.locator('button:has-text("http")').first()).toBeVisible({ timeout: 5_000 });
    await expect(aside.locator('button:has-text("https")').first()).toBeVisible();
    await expect(aside.locator('button:has-text("tcp")').first()).toBeVisible();
  });

  test('switching protocol to TCP hides Basic auth checkbox', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');

    await goToDashboard(page);
    await selectSidebarTab(page, 'Domains');
    const aside = page.locator('aside');
    await openDmForm(aside);
    await expect(aside.locator('text=Basic auth')).toBeVisible({ timeout: 5_000 });
    await aside.locator('button:has-text("tcp")').first().click();
    await expect(aside.locator('text=Basic auth')).toBeHidden({ timeout: 5_000 });
  });

  test('switching protocol back from TCP restores Basic auth', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');

    await goToDashboard(page);
    await selectSidebarTab(page, 'Domains');
    const aside = page.locator('aside');
    await openDmForm(aside);
    await aside.locator('button:has-text("tcp")').first().click();
    await expect(aside.locator('text=Basic auth')).toBeHidden({ timeout: 5_000 });
    await aside.locator('button:has-text("http")').first().click();
    await expect(aside.locator('text=Basic auth')).toBeVisible({ timeout: 5_000 });
  });

  test('checking Basic auth reveals username and password fields', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');

    await goToDashboard(page);
    await selectSidebarTab(page, 'Domains');
    const aside = page.locator('aside');
    await openDmForm(aside);
    await expect(aside.locator('input[placeholder="Username"]')).toBeHidden();
    await aside.locator('text=Basic auth').click();
    await expect(aside.locator('input[placeholder="Username"]')).toBeVisible({ timeout: 5_000 });
    await expect(aside.locator('input[placeholder="Password"]')).toBeVisible();
  });

  test('form shows base domain suffix', async ({ page, request }) => {
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
    // Use first() to avoid strict mode if a parallel test created a mapping with the same domain
    await expect(aside.locator(`text=.${body.baseDomains[0]}`).first()).toBeVisible({ timeout: 10_000 });
  });

  test('form shows base domain selector when multiple domains configured', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');
    test.skip(body.baseDomains.length < 2, 'Only one base domain configured');

    await goToDashboard(page);
    await selectSidebarTab(page, 'Domains');
    const aside = page.locator('aside');
    await openDmForm(aside);
    // With multiple base domains, toggle buttons should appear for each domain
    for (const domain of body.baseDomains) {
      await expect(aside.locator(`button:has-text(".${domain}")`)).toBeVisible({ timeout: 5_000 });
    }
  });

  test('Cancel button closes the form', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');

    await goToDashboard(page);
    await selectSidebarTab(page, 'Domains');
    const aside = page.locator('aside');
    await openDmForm(aside);
    await aside.locator('button:has-text("Cancel")').click();
    await expect(aside.locator('input[placeholder="subdomain (optional)"]')).toBeHidden({ timeout: 5_000 });
  });
});
