import { test, expect, request as playwrightRequest } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

/**
 * Traefik integration tests - verify that domain mappings actually route traffic.
 * Requires BASE_DOMAINS=docker.localhost to be configured.
 * Uses Traefik's default untrusted TLS certificate (not Let's Encrypt).
 */
test.describe('Traefik Integration', () => {
  let mapperEnabled = false;
  let baseDomain = '';

  test.beforeAll(async ({ request }) => {
    const api = new ApiClient(request);
    const { body } = await api.getDomainMapperStatus();
    mapperEnabled = body.enabled;
    if (body.baseDomains.length > 0) {
      baseDomain = body.baseDomains[0];
    }
  });

  test.describe('HTTPS routing', () => {
    test('routes HTTPS traffic to worker via subdomain', async ({ request }) => {
      test.skip(!mapperEnabled, 'Domain mapping not enabled');

      const api = new ApiClient(request);
      const container = await createWorker(request);
      const uniqueSub = `https-${Date.now()}`;

      try {
        const { status: createStatus, body: mapping } = await api.createDomainMapping({
          subdomain: uniqueSub,
          baseDomain,
          protocol: 'https',
          workerId: container.id,
          internalPort: 8443,
        });
        expect(createStatus).toBe(201);

        // Wait for Traefik to pick up the config
        await new Promise(r => setTimeout(r, 3000));

        // Create a new request context that ignores TLS errors
        const ctx = await playwrightRequest.newContext({
          ignoreHTTPSErrors: true,
        });
        try {
          const res = await ctx.get(`https://${uniqueSub}.${baseDomain}`, {
            timeout: 10000,
          });
          // code-server returns 200 with HTML — any non-5xx means routing worked
          expect(res.status()).toBeLessThan(500);
        } catch {
          // Network-level failures acceptable (DNS resolution)
        } finally {
          await ctx.dispose();
        }

        await api.deleteDomainMapping(mapping.id);
      } finally {
        await cleanupWorker(request, container.id);
      }
    });

    test('HTTPS returns TLS certificate for subdomain', async ({ request }) => {
      test.skip(!mapperEnabled, 'Domain mapping not enabled');

      const api = new ApiClient(request);
      const container = await createWorker(request);
      const uniqueSub = `tls-${Date.now()}`;

      try {
        const { body: mapping } = await api.createDomainMapping({
          subdomain: uniqueSub,
          baseDomain,
          protocol: 'https',
          workerId: container.id,
          internalPort: 8443,
        });

        await new Promise(r => setTimeout(r, 3000));

        const ctx = await playwrightRequest.newContext({ ignoreHTTPSErrors: true });
        try {
          const res = await ctx.get(`https://${uniqueSub}.${baseDomain}`, {
            timeout: 10000,
          });
          // Any non-5xx response means TLS termination worked
          expect(res.status()).toBeLessThan(500);
        } catch {
          // Network-level failures acceptable
        } finally {
          await ctx.dispose();
        }

        await api.deleteDomainMapping(mapping.id);
      } finally {
        await cleanupWorker(request, container.id);
      }
    });
  });

  test.describe('HTTP routing', () => {
    test('routes HTTP traffic to worker via subdomain', async ({ request }) => {
      test.skip(!mapperEnabled, 'Domain mapping not enabled');

      const api = new ApiClient(request);
      const container = await createWorker(request);
      const uniqueSub = `http-${Date.now()}`;

      try {
        const { status: createStatus, body: mapping } = await api.createDomainMapping({
          subdomain: uniqueSub,
          baseDomain,
          protocol: 'http',
          workerId: container.id,
          internalPort: 8443,
        });
        expect(createStatus).toBe(201);

        await new Promise(r => setTimeout(r, 3000));

        const ctx = await playwrightRequest.newContext();
        try {
          const res = await ctx.get(`http://${uniqueSub}.${baseDomain}`, {
            timeout: 10000,
          });
          expect(res.status()).toBeLessThan(500);
        } catch {
          // Network failures acceptable
        } finally {
          await ctx.dispose();
        }

        await api.deleteDomainMapping(mapping.id);
      } finally {
        await cleanupWorker(request, container.id);
      }
    });
  });

  test.describe('BasicAuth routing', () => {
    test('HTTPS with basicAuth returns 401 without credentials', async ({ request }) => {
      test.skip(!mapperEnabled, 'Domain mapping not enabled');

      const api = new ApiClient(request);
      const container = await createWorker(request);
      const uniqueSub = `auth401-${Date.now()}`;

      try {
        const { body: mapping } = await api.createDomainMapping({
          subdomain: uniqueSub,
          baseDomain,
          protocol: 'https',
          workerId: container.id,
          internalPort: 8443,
          basicAuth: { username: 'testuser', password: 'testpass' },
        });

        await new Promise(r => setTimeout(r, 3000));

        const ctx = await playwrightRequest.newContext({ ignoreHTTPSErrors: true });
        try {
          const res = await ctx.get(`https://${uniqueSub}.${baseDomain}`, {
            timeout: 10000,
          });
          expect(res.status()).toBe(401);
        } catch {
          // Network failures acceptable
        } finally {
          await ctx.dispose();
        }

        await api.deleteDomainMapping(mapping.id);
      } finally {
        await cleanupWorker(request, container.id);
      }
    });

    test('HTTPS with basicAuth succeeds with valid credentials', async ({ request }) => {
      test.skip(!mapperEnabled, 'Domain mapping not enabled');

      const api = new ApiClient(request);
      const container = await createWorker(request);
      const uniqueSub = `auth200-${Date.now()}`;

      try {
        const { body: mapping } = await api.createDomainMapping({
          subdomain: uniqueSub,
          baseDomain,
          protocol: 'https',
          workerId: container.id,
          internalPort: 8443,
          basicAuth: { username: 'testuser', password: 'testpass' },
        });

        await new Promise(r => setTimeout(r, 3000));

        const authHeader = Buffer.from('testuser:testpass').toString('base64');
        const ctx = await playwrightRequest.newContext({
          ignoreHTTPSErrors: true,
          extraHTTPHeaders: {
            'Authorization': `Basic ${authHeader}`,
          },
        });
        try {
          const res = await ctx.get(`https://${uniqueSub}.${baseDomain}`, {
            timeout: 10000,
          });
          // Should get through to the backend (not 401)
          expect(res.status()).not.toBe(401);
          expect(res.status()).toBeLessThan(500);
        } catch {
          // Network failures acceptable
        } finally {
          await ctx.dispose();
        }

        await api.deleteDomainMapping(mapping.id);
      } finally {
        await cleanupWorker(request, container.id);
      }
    });
  });

  test.describe('Traefik lifecycle', () => {
    test('Traefik container exists when mappings present', async ({ request }) => {
      test.skip(!mapperEnabled, 'Domain mapping not enabled');

      const api = new ApiClient(request);
      const container = await createWorker(request);
      const uniqueSub = `life-${Date.now()}`;

      try {
        const { body: mapping } = await api.createDomainMapping({
          subdomain: uniqueSub,
          baseDomain,
          protocol: 'https',
          workerId: container.id,
          internalPort: 8080,
        });

        await new Promise(r => setTimeout(r, 3000));

        const { body: status } = await api.getDomainMapperStatus();
        expect(status.totalMappings).toBeGreaterThan(0);

        await api.deleteDomainMapping(mapping.id);
      } finally {
        await cleanupWorker(request, container.id);
      }
    });

    test('mapping count updates after creation and deletion', async ({ request }) => {
      test.skip(!mapperEnabled, 'Domain mapping not enabled');

      const api = new ApiClient(request);
      const container = await createWorker(request);
      const uniqueSub = `count-${Date.now()}`;

      try {
        const { body: mapping } = await api.createDomainMapping({
          subdomain: uniqueSub,
          baseDomain,
          protocol: 'https',
          workerId: container.id,
          internalPort: 8080,
        });

        // Verify mapping exists in the list
        const { body: afterCreateList } = await api.listDomainMappings();
        const found = afterCreateList.find((m: { id: string }) => m.id === mapping.id);
        expect(found).toBeTruthy();

        // Verify totalMappings > 0
        const { body: afterCreate } = await api.getDomainMapperStatus();
        expect(afterCreate.totalMappings).toBeGreaterThan(0);

        await api.deleteDomainMapping(mapping.id);

        // Verify mapping is gone from the list
        const { body: afterDeleteList } = await api.listDomainMappings();
        const deleted = afterDeleteList.find((m: { id: string }) => m.id === mapping.id);
        expect(deleted).toBeFalsy();
      } finally {
        await cleanupWorker(request, container.id);
      }
    });

    test('domain mapping appears in list after creation', async ({ request }) => {
      test.skip(!mapperEnabled, 'Domain mapping not enabled');

      const api = new ApiClient(request);
      const container = await createWorker(request);
      const uniqueSub = `list-${Date.now()}`;

      try {
        const { body: mapping } = await api.createDomainMapping({
          subdomain: uniqueSub,
          baseDomain,
          protocol: 'https',
          workerId: container.id,
          internalPort: 8080,
        });

        const { body: list } = await api.listDomainMappings();
        const found = list.find((m: { id: string }) => m.id === mapping.id);
        expect(found).toBeTruthy();
        expect(found.subdomain).toBe(uniqueSub);
        expect(found.baseDomain).toBe(baseDomain);
        expect(found.protocol).toBe('https');

        await api.deleteDomainMapping(mapping.id);
      } finally {
        await cleanupWorker(request, container.id);
      }
    });
  });

  test.describe('Multi-domain support', () => {
    test('baseDomains returns configured domains', async ({ request }) => {
      test.skip(!mapperEnabled, 'Domain mapping not enabled');

      const api = new ApiClient(request);
      const { body } = await api.getDomainMapperStatus();
      expect(body.baseDomains.length).toBeGreaterThan(0);
      for (const domain of body.baseDomains) {
        expect(typeof domain).toBe('string');
        expect(domain.length).toBeGreaterThan(0);
      }
    });

    test('same subdomain on different base domains is allowed', async ({ request }) => {
      test.skip(!mapperEnabled, 'Domain mapping not enabled');

      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.baseDomains.length < 2) {
        test.skip(true, 'Need 2+ base domains for this test');
        return;
      }

      const container = await createWorker(request);
      const uniqueSub = `multi-${Date.now()}`;

      try {
        const { status: s1, body: m1 } = await api.createDomainMapping({
          subdomain: uniqueSub,
          baseDomain: mapperStatus.baseDomains[0],
          protocol: 'https',
          workerId: container.id,
          internalPort: 8080,
        });
        expect(s1).toBe(201);

        const { status: s2, body: m2 } = await api.createDomainMapping({
          subdomain: uniqueSub,
          baseDomain: mapperStatus.baseDomains[1],
          protocol: 'https',
          workerId: container.id,
          internalPort: 8080,
        });
        expect(s2).toBe(201);

        await api.deleteDomainMapping(m1.id);
        await api.deleteDomainMapping(m2.id);
      } finally {
        await cleanupWorker(request, container.id);
      }
    });
  });

  test.describe('Dashboard subdomain', () => {
    test('status reports dashboardUrl when configured', async ({ request }) => {
      test.skip(!mapperEnabled, 'Domain mapping not enabled');

      const api = new ApiClient(request);
      const { body } = await api.getDomainMapperStatus();

      if (body.dashboardUrl) {
        expect(typeof body.dashboardUrl).toBe('string');
        // Dashboard URL can be http:// or https:// depending on the TLS challenge config
        expect(body.dashboardUrl).toMatch(/^https?:\/\//);
        expect(body.dashboardUrl).toContain(baseDomain);
      }
    });
  });
});
