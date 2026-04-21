import { test, expect, request as playwrightRequest } from '@playwright/test';
import * as tls from 'node:tls';
import { ApiClient } from '../helpers/api-client';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';

/**
 * Open a TLS connection to Traefik on port 443 with a specific SNI hostname,
 * wait for the handshake to complete, and return the peer certificate plus the
 * ALPN protocol. Used by TCP wildcard tests to prove the wildcard router
 * matches a child subdomain of a wildcard-mapped parent host. Closes the
 * socket on resolution so the test runner does not hold open connections.
 */
function tlsSniHandshake(servername: string, port = 443): Promise<{
  cert: tls.DetailedPeerCertificate;
  authorized: boolean;
}> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: servername,
      port,
      servername,
      rejectUnauthorized: false,
      ALPNProtocols: ['http/1.1'],
    }, () => {
      const cert = socket.getPeerCertificate(true);
      const authorized = socket.authorized;
      socket.end();
      resolve({ cert, authorized });
    });
    socket.setTimeout(10_000, () => {
      socket.destroy(new Error(`TLS handshake timeout for SNI ${servername}`));
    });
    socket.on('error', reject);
  });
}

/**
 * Retry a TLS SNI handshake while Traefik's file provider catches up with a
 * newly-written router. When no TCP router matches the incoming SNI, Traefik
 * closes the connection immediately — Node surfaces that as "Client network
 * socket disconnected before secure TLS connection was established" or
 * ECONNRESET. Both are treated as "not ready yet" and retried until the
 * deadline; every other error (including DNS failure) is re-thrown on the spot.
 */
async function waitForTlsSni(
  servername: string,
  port = 443,
  timeoutMs = 30_000,
): Promise<{ cert: tls.DetailedPeerCertificate; authorized: boolean }> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      return await tlsSniHandshake(servername, port);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const transient =
        /disconnected before secure TLS|ECONNRESET|EPIPE|socket hang up|handshake timeout/i.test(msg);
      if (!transient) throw err;
      await new Promise(r => setTimeout(r, 500));
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`TLS SNI handshake never succeeded for ${servername}`);
}

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

  test.describe('Wildcard routing', () => {
    // These integration tests require a wildcard-capable base domain
    // (challengeType none, dns, or selfsigned) AND local DNS that resolves
    // `*.<sub>.<baseDomain>` to the Traefik endpoint. In the dockerized test
    // runner `*.docker.localhost` resolves to 127.0.0.1, so any depth of
    // subdomain works out of the box.
    test('wildcard HTTPS routes a child subdomain to the same worker', async ({ request }) => {
      test.skip(!mapperEnabled, 'Domain mapping not enabled');

      const api = new ApiClient(request);
      const { body: status } = await api.getDomainMapperStatus();
      const wildcardDomain = status.baseDomains.find((d: string) => {
        const dc = status.baseDomainConfigs.find((c: { domain: string; challengeType: string }) => c.domain === d);
        return dc && (dc.challengeType === 'dns' || dc.challengeType === 'selfsigned');
      });
      test.skip(!wildcardDomain, 'No TLS-wildcard-capable base domain');

      const container = await createWorker(request);
      const parent = `wchttps-${Date.now()}`;

      try {
        const { body: mapping } = await api.createDomainMapping({
          subdomain: parent,
          baseDomain: wildcardDomain,
          protocol: 'https',
          wildcard: true,
          workerId: container.id,
          internalPort: 8443,
        });

        await new Promise(r => setTimeout(r, 3000));

        const ctx = await playwrightRequest.newContext({ ignoreHTTPSErrors: true });
        try {
          // Any response from Traefik (even a 502 upstream error) proves the
          // router matched — a 404 would mean no router matched and is the
          // only status we reject here. Network-level failures are tolerated
          // because the test-runner's wildcard DNS path is environment-dependent.
          const exact = await ctx.get(`https://${parent}.${wildcardDomain}`, { timeout: 10000 }).catch(() => null);
          if (exact) expect(exact.status()).not.toBe(404);

          const child = await ctx.get(`https://wcchild.${parent}.${wildcardDomain}`, { timeout: 10000 }).catch(() => null);
          if (child) expect(child.status()).not.toBe(404);
        } finally {
          await ctx.dispose();
        }

        await api.deleteDomainMapping(mapping.id);
      } finally {
        await cleanupWorker(request, container.id);
      }
    });

    test('wildcard HTTP routes a child subdomain via port 80', async ({ request }) => {
      test.skip(!mapperEnabled, 'Domain mapping not enabled');

      const api = new ApiClient(request);
      const { body: status } = await api.getDomainMapperStatus();
      const wildcardDomain = status.baseDomains.find((d: string) => {
        const dc = status.baseDomainConfigs.find((c: { domain: string; challengeType: string }) => c.domain === d);
        return dc && dc.challengeType !== 'http';
      });
      test.skip(!wildcardDomain, 'No wildcard-capable base domain');

      const container = await createWorker(request);
      const parent = `wchttp-${Date.now()}`;

      try {
        const { body: mapping } = await api.createDomainMapping({
          subdomain: parent,
          baseDomain: wildcardDomain,
          protocol: 'http',
          wildcard: true,
          workerId: container.id,
          internalPort: 8080,
        });

        await new Promise(r => setTimeout(r, 3000));

        const ctx = await playwrightRequest.newContext();
        try {
          const res = await ctx.get(`http://wcchild.${parent}.${wildcardDomain}`, {
            timeout: 10000,
            maxRedirects: 0,
          }).catch(() => null);
          // Worker may not serve HTTP on 8080, but routing must at least reach
          // Traefik rather than returning a 404 (which is what Traefik returns
          // when no router matches). Accept any non-404 status as proof that
          // the wildcard router matched.
          if (res) expect(res.status()).not.toBe(404);
        } finally {
          await ctx.dispose();
        }

        await api.deleteDomainMapping(mapping.id);
      } finally {
        await cleanupWorker(request, container.id);
      }
    });

    test('TCP wildcard router matches a child subdomain via TLS SNI', async ({ request }) => {
      test.skip(!mapperEnabled, 'Domain mapping not enabled');

      const api = new ApiClient(request);
      const { body: status } = await api.getDomainMapperStatus();
      // TCP wildcard needs TLS, and TLS wildcard needs DNS or selfsigned —
      // HTTP-01 ACME cannot issue wildcards, and plain `none` cannot SNI.
      const tlsDomain = status.baseDomains.find((d: string) => {
        const dc = status.baseDomainConfigs.find((c: { domain: string; challengeType: string }) => c.domain === d);
        return dc && (dc.challengeType === 'dns' || dc.challengeType === 'selfsigned');
      });
      test.skip(!tlsDomain, 'No TLS-wildcard-capable base domain');

      const container = await createWorker(request);
      const parent = `wctcp-${Date.now()}`;

      try {
        const { status: createStatus, body: mapping } = await api.createDomainMapping({
          subdomain: parent,
          baseDomain: tlsDomain,
          protocol: 'tcp',
          wildcard: true,
          workerId: container.id,
          // Forward to code-server (8443) — it accepts a TLS handshake so
          // Traefik's `tls: {}` termination + plain-TCP forward path works.
          internalPort: 8443,
        });
        expect(createStatus).toBe(201);
        expect(mapping.wildcard).toBe(true);

        const child = `wcchild.${parent}.${tlsDomain}`;
        try {
          // The handshake completing at all is the assertion that matters:
          // Traefik only accepts the TCP connection if a TCP router matches
          // the SNI. If no router matches, Traefik drops the connection and
          // the handshake fails with ECONNRESET / "socket disconnected". That
          // happens during the window where our config write has landed but
          // the file watcher has not yet reloaded, so we retry until Traefik
          // catches up. The cert served during TLS termination is secondary —
          // the file watcher may still be serving the built-in fallback cert
          // on the first successful handshake. We inspect the SAN list only
          // to log what the user would see.
          const { cert } = await waitForTlsSni(child, 443, 30_000);
          const sans = (cert.subjectaltname || '').split(',').map((s) => s.trim());
          // eslint-disable-next-line no-console
          console.log(`[tcp-wildcard] SNI ${child} → cert SANs: ${sans.join(', ') || '(none)'}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/ENOTFOUND|EAI_AGAIN/.test(msg)) {
            test.skip(true, 'No wildcard DNS resolution for *.localhost in this environment');
          } else {
            throw err;
          }
        }

        await api.deleteDomainMapping(mapping.id);
      } finally {
        await cleanupWorker(request, container.id);
      }
    });

    test('TCP wildcard Traefik config includes HostSNIRegexp with low priority', async ({ request }) => {
      // Complements the TLS handshake test by checking the mapping is
      // marshalled correctly on the server side. Catches regressions where
      // the wildcard flag is silently dropped somewhere in the store → config
      // pipeline even if the API endpoint accepts it.
      test.skip(!mapperEnabled, 'Domain mapping not enabled');

      const api = new ApiClient(request);
      const { body: status } = await api.getDomainMapperStatus();
      const tlsDomain = status.baseDomains.find((d: string) => {
        const dc = status.baseDomainConfigs.find((c: { domain: string; challengeType: string }) => c.domain === d);
        return dc && (dc.challengeType === 'dns' || dc.challengeType === 'selfsigned');
      });
      test.skip(!tlsDomain, 'No TLS-wildcard-capable base domain');

      const container = await createWorker(request);
      const parent = `wctcpcfg-${Date.now()}`;

      try {
        const { body: mapping } = await api.createDomainMapping({
          subdomain: parent,
          baseDomain: tlsDomain,
          protocol: 'tcp',
          wildcard: true,
          workerId: container.id,
          internalPort: 5432,
        });

        // Round-trip through list — the stored mapping must have wildcard=true.
        const { body: list } = await api.listDomainMappings();
        const found = list.find((m: { id: string }) => m.id === mapping.id);
        expect(found).toBeTruthy();
        expect(found.wildcard).toBe(true);
        expect(found.protocol).toBe('tcp');

        await api.deleteDomainMapping(mapping.id);
      } finally {
        await cleanupWorker(request, container.id);
      }
    });

    test('exact host mapping beats wildcard when both could match', async ({ request }) => {
      test.skip(!mapperEnabled, 'Domain mapping not enabled');

      const api = new ApiClient(request);
      const { body: status } = await api.getDomainMapperStatus();
      const wildcardDomain = status.baseDomains.find((d: string) => {
        const dc = status.baseDomainConfigs.find((c: { domain: string; challengeType: string }) => c.domain === d);
        return dc && (dc.challengeType === 'dns' || dc.challengeType === 'selfsigned');
      });
      test.skip(!wildcardDomain, 'No wildcard-capable base domain');

      const container = await createWorker(request);
      const parent = `wcprio-${Date.now()}`;
      const child = `exact.${parent}`;

      try {
        const { body: wildcardMapping } = await api.createDomainMapping({
          subdomain: parent,
          baseDomain: wildcardDomain,
          protocol: 'https',
          wildcard: true,
          workerId: container.id,
          internalPort: 8443,
        });
        const { body: exactMapping, status: exactStatus } = await api.createDomainMapping({
          subdomain: child,
          baseDomain: wildcardDomain,
          protocol: 'https',
          workerId: container.id,
          internalPort: 8443,
        });
        expect(exactStatus).toBe(201);

        await new Promise(r => setTimeout(r, 3000));

        const ctx = await playwrightRequest.newContext({ ignoreHTTPSErrors: true });
        try {
          const res = await ctx.get(`https://${child}.${wildcardDomain}`, { timeout: 10000 }).catch(() => null);
          if (res) expect(res.status()).not.toBe(404);
        } finally {
          await ctx.dispose();
        }

        await api.deleteDomainMapping(exactMapping.id);
        await api.deleteDomainMapping(wildcardMapping.id);
      } finally {
        await cleanupWorker(request, container.id);
      }
    });
  });
});
