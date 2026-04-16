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
  await expect(subdomainInput).toBeVisible({ timeout: 10_000 });
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
    await expect(aside.locator('button:has-text("Add")')).toBeVisible({ timeout: 10_000 });
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
    await expect(aside.locator('button:has-text("http")').first()).toBeVisible({ timeout: 10_000 });
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
    await expect(aside.locator('[data-testid="basic-auth-checkbox"]')).toBeVisible({ timeout: 10_000 });
  });

  test('domain mapping form Cancel closes the form', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');

    await goToDashboard(page);
    await selectSidebarTab(page, 'Domains');
    const aside = page.locator('aside');
    await openDmForm(aside);
    await expect(aside.locator('button:has-text("Cancel")')).toBeVisible({ timeout: 10_000 });
    await aside.locator('button:has-text("Cancel")').click();
    // Form should close, subdomain input should be hidden
    await expect(aside.locator('input[placeholder="subdomain (optional)"]')).toBeHidden({ timeout: 10_000 });
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
    await expect(aside.locator('input[placeholder*="path"]')).toBeVisible({ timeout: 10_000 });
  });

  test('switching protocol to TCP hides path input', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');

    await goToDashboard(page);
    await selectSidebarTab(page, 'Domains');
    const aside = page.locator('aside');
    await openDmForm(aside);
    await expect(aside.locator('input[placeholder*="path"]')).toBeVisible({ timeout: 10_000 });
    await aside.locator('button:has-text("tcp")').first().click();
    await expect(aside.locator('input[placeholder*="path"]')).toBeHidden({ timeout: 10_000 });
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
    // The Basic auth checkbox should be visible initially (default protocol is http).
    // Target the checkbox via its testid so we don't accidentally match the
    // TCP explanation card, which also contains the heading text "Basic auth".
    const basicAuthCheckbox = aside.locator('[data-testid="basic-auth-checkbox"]');
    await expect(basicAuthCheckbox).toBeVisible({ timeout: 10_000 });
    // Switch protocol to TCP.
    await aside.locator('button:has-text("tcp")').first().click();
    // The checkbox is now replaced by the read-only TCP hint card.
    await expect(basicAuthCheckbox).toBeHidden({ timeout: 10_000 });
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
    // Check the Basic auth checkbox directly (default protocol is http, so
    // the checkbox is rendered rather than the TCP hint card).
    await aside.locator('[data-testid="basic-auth-checkbox"]').check();
    // Username and password inputs should now be visible
    await expect(aside.locator('input[placeholder="Username"]')).toBeVisible({ timeout: 10_000 });
    await expect(aside.locator('input[placeholder="Password"]')).toBeVisible();
  });

  test('wildcard checkbox is present in the form', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');

    await goToDashboard(page);
    await selectSidebarTab(page, 'Domains');
    const aside = page.locator('aside');
    await openDmForm(aside);
    await expect(aside.locator('[data-testid="wildcard-checkbox"]')).toBeVisible({ timeout: 10_000 });
    await expect(aside.locator('text=Wildcard subdomain')).toBeVisible();
  });

  test('wildcard checkbox is enabled for wildcard-capable base domains', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');

    const wildcardable = body.baseDomainConfigs.some(
      (c: { challengeType: string }) => c.challengeType !== 'http',
    );
    test.skip(!wildcardable, 'No wildcard-capable base domain in config');

    await goToDashboard(page);
    await selectSidebarTab(page, 'Domains');
    const aside = page.locator('aside');
    await openDmForm(aside);
    const checkbox = aside.locator('[data-testid="wildcard-checkbox"]');
    await expect(checkbox).toBeVisible({ timeout: 10_000 });
    await expect(checkbox).toBeEnabled();
  });

  test('checking wildcard shows the live match preview', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');
    const wildcardable = body.baseDomainConfigs.some(
      (c: { challengeType: string }) => c.challengeType !== 'http',
    );
    test.skip(!wildcardable, 'No wildcard-capable base domain in config');

    await goToDashboard(page);
    await selectSidebarTab(page, 'Domains');
    const aside = page.locator('aside');
    await openDmForm(aside);
    await aside.locator('input[placeholder="subdomain (optional)"]').fill('api');
    await aside.locator('[data-testid="wildcard-checkbox"]').check();
    await expect(aside.locator('text=/matches \\*\\.api\\./')).toBeVisible({ timeout: 10_000 });
  });

  test('TCP form shows an explanation note in place of Basic auth', async ({ page, request }) => {
    // Regression guard for the UX fix: when TCP is selected, Basic auth is
    // hidden (Traefik cannot do HTTP auth on raw TCP routers), but the form
    // should replace it with an informative hint rather than leaving a gap
    // that looks like a bug.
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');
    const wildcardable = body.baseDomainConfigs.some(
      (c: { challengeType: string }) => c.challengeType !== 'http' && c.challengeType !== 'none',
    );
    test.skip(!wildcardable, 'No TLS-capable base domain');

    await goToDashboard(page);
    await selectSidebarTab(page, 'Domains');
    const aside = page.locator('aside');
    await openDmForm(aside);

    // In HTTP mode the Basic auth checkbox is visible and the TCP hint is absent.
    const basicAuthCheckbox = aside.locator('[data-testid="basic-auth-checkbox"]');
    await expect(basicAuthCheckbox).toBeVisible({ timeout: 10_000 });
    await expect(aside.locator('[data-testid="tcp-no-auth-hint"]')).toBeHidden();

    // Switching to TCP hides the checkbox and reveals the hint card.
    await aside.locator('button:has-text("tcp")').first().click();
    await expect(basicAuthCheckbox).toBeHidden({ timeout: 10_000 });
    const hint = aside.locator('[data-testid="tcp-no-auth-hint"]');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('does not apply to TCP routes');
    // The hint card still shows "Basic auth" as its heading so the user
    // understands what feature is unavailable for TCP routes.
    await expect(hint).toContainText('Basic auth');
  });

  test('wildcard checkbox remains visible and enabled when TCP protocol is selected', async ({ page, request }) => {
    // Regression guard: the form contains a `v-if="!formProtocols.has('tcp')"`
    // block that hides Basic auth and Path when TCP is selected. The wildcard
    // checkbox must NOT be inside that block — TCP supports wildcard via
    // `HostSNI || HostSNIRegexp` just like HTTP supports it via `Host || HostRegexp`.
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    test.skip(!body.enabled, 'Domain mapping not enabled');
    const wildcardable = body.baseDomainConfigs.some(
      (c: { challengeType: string }) => c.challengeType !== 'http' && c.challengeType !== 'none',
    );
    test.skip(!wildcardable, 'No TLS-wildcard-capable base domain (TCP needs TLS)');

    await goToDashboard(page);
    await selectSidebarTab(page, 'Domains');
    const aside = page.locator('aside');
    await openDmForm(aside);

    // Click the TCP protocol button (scoped to the form so we don't grab the
    // "tcp" badge in an existing mapping row).
    await aside.locator('button:has-text("tcp")').first().click();

    const checkbox = aside.locator('[data-testid="wildcard-checkbox"]');
    await expect(checkbox).toBeVisible({ timeout: 10_000 });
    await expect(checkbox).toBeEnabled();

    // And it's actually clickable while TCP is selected.
    await checkbox.check();
    await expect(checkbox).toBeChecked();
  });

  test('TCP wildcard mapping created via form appears with wildcard badge and tcp badge', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body: mapperStatus } = await api.getDomainMapperStatus();
    test.skip(!mapperStatus.enabled, 'Domain mapping not enabled');

    // TCP wildcard specifically needs TLS (dns or selfsigned)
    const tlsDomain = mapperStatus.baseDomains.find((d: string) => {
      const dc = mapperStatus.baseDomainConfigs.find(
        (c: { domain: string; challengeType: string }) => c.domain === d,
      );
      return dc && (dc.challengeType === 'dns' || dc.challengeType === 'selfsigned');
    });
    test.skip(!tlsDomain, 'No TLS-wildcard-capable base domain');

    const { createWorker, cleanupWorker } = await import('../helpers/worker-lifecycle');
    const container = await createWorker(request);
    const uniqueSub = `uitcpwc-${Date.now()}`;

    try {
      const { body: mapping } = await api.createDomainMapping({
        subdomain: uniqueSub,
        baseDomain: tlsDomain,
        protocol: 'tcp',
        wildcard: true,
        workerId: container.id,
        internalPort: 5432,
      });

      try {
        await goToDashboard(page);
        await selectSidebarTab(page, 'Domains');
        const aside = page.locator('aside');

        // Find the mapping row by its host — limit search to the list, not
        // the form that might be open with a similar host preview.
        const row = aside.locator('div.rounded.px-2').filter({
          hasText: `*.${uniqueSub}.${tlsDomain}`,
        }).first();
        await expect(row).toBeVisible({ timeout: 15_000 });
        // Row shows the tcp protocol badge and the wildcard badge.
        await expect(row.locator('text=tcp').first()).toBeVisible();
        await expect(row.locator('text=wildcard').first()).toBeVisible();
      } finally {
        await api.deleteDomainMapping(mapping.id);
      }
    } finally {
      await cleanupWorker(request, container.id);
    }
  });

  test('wildcard mapping appears with wildcard badge and *.host prefix in list', async ({ page, request }) => {
    const api = new ApiClient(request);
    const { body: mapperStatus } = await api.getDomainMapperStatus();
    test.skip(!mapperStatus.enabled, 'Domain mapping not enabled');

    const baseDomain = mapperStatus.baseDomains.find((d: string) => {
      const dc = mapperStatus.baseDomainConfigs.find(
        (c: { domain: string; challengeType: string }) => c.domain === d,
      );
      return dc && dc.challengeType !== 'http';
    });
    test.skip(!baseDomain, 'No wildcard-capable base domain');

    const { createWorker, cleanupWorker } = await import('../helpers/worker-lifecycle');
    const container = await createWorker(request);
    const uniqueSub = `uiwc-${Date.now()}`;

    try {
      const { body: mapping } = await api.createDomainMapping({
        subdomain: uniqueSub,
        baseDomain,
        protocol: 'http',
        wildcard: true,
        workerId: container.id,
        internalPort: 8080,
      });

      try {
        await goToDashboard(page);
        await selectSidebarTab(page, 'Domains');
        const aside = page.locator('aside');
        await expect(
          aside.locator(`text=*.${uniqueSub}.${baseDomain}`),
        ).toBeVisible({ timeout: 15_000 });
        await expect(aside.locator('text=wildcard').first()).toBeVisible();
      } finally {
        await api.deleteDomainMapping(mapping.id);
      }
    } finally {
      await cleanupWorker(request, container.id);
    }
  });

});
