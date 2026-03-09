import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';

test.describe('Self-Signed Certificates', () => {
  test.describe('GET /api/domain-mapper/status', () => {
    test('includes baseDomainConfigs with challengeType', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.getDomainMapperStatus();
      expect(status).toBe(200);

      if (body.enabled && body.baseDomainConfigs) {
        for (const config of body.baseDomainConfigs) {
          expect(typeof config.domain).toBe('string');
          expect(['none', 'http', 'dns', 'selfsigned']).toContain(config.challengeType);
        }
      }
    });

    test('hasSelfSignedCa is true when selfsigned domains exist', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.getDomainMapperStatus();

      if (!body.enabled) return;

      const hasSelfSigned = body.baseDomainConfigs?.some(
        (c: { challengeType: string }) => c.challengeType === 'selfsigned'
      );

      if (hasSelfSigned) {
        expect(body.hasSelfSignedCa).toBe(true);
      } else {
        expect(body.hasSelfSignedCa).toBeUndefined();
      }
    });
  });

  test.describe('GET /api/domain-mapper/ca-cert', () => {
    test('returns CA cert PEM when selfsigned domains exist', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      const hasSelfSigned = mapperStatus.baseDomainConfigs?.some(
        (c: { challengeType: string }) => c.challengeType === 'selfsigned'
      );

      if (!hasSelfSigned) {
        // Should return 404 when no selfsigned domains
        const { status } = await api.getCaCert();
        expect(status).toBe(404);
        return;
      }

      const { status, body, headers } = await api.getCaCert();
      expect(status).toBe(200);
      expect(body).toContain('-----BEGIN CERTIFICATE-----');
      expect(body).toContain('-----END CERTIFICATE-----');
      expect(headers['content-type']).toContain('application/x-pem-file');
      expect(headers['content-disposition']).toContain('agentor-ca.crt');
    });

    test('returns 404 when no selfsigned domains configured', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      const hasSelfSigned = mapperStatus.baseDomainConfigs?.some(
        (c: { challengeType: string }) => c.challengeType === 'selfsigned'
      );

      if (hasSelfSigned) {
        // Skip — this test only runs when no selfsigned domains exist
        return;
      }

      const { status } = await api.getCaCert();
      expect(status).toBe(404);
    });
  });

  test.describe('Self-signed domain mapping creation', () => {
    test('allows HTTPS protocol on selfsigned domains', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (!mapperStatus.enabled) return;

      const selfSignedDomain = mapperStatus.baseDomainConfigs?.find(
        (c: { challengeType: string }) => c.challengeType === 'selfsigned'
      );

      if (!selfSignedDomain) return;

      const container = await createWorker(request);
      try {
        const uniqueSub = `ss-https-${Date.now()}`;
        const { status, body } = await api.createDomainMapping({
          subdomain: uniqueSub,
          baseDomain: selfSignedDomain.domain,
          protocol: 'https',
          workerId: container.id,
          internalPort: 8080,
        });
        expect(status).toBe(201);
        expect(body.protocol).toBe('https');
        expect(body.baseDomain).toBe(selfSignedDomain.domain);

        await api.deleteDomainMapping(body.id);
      } finally {
        await cleanupWorker(request, container.id);
      }
    });

    test('allows TCP protocol on selfsigned domains', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (!mapperStatus.enabled) return;

      const selfSignedDomain = mapperStatus.baseDomainConfigs?.find(
        (c: { challengeType: string }) => c.challengeType === 'selfsigned'
      );

      if (!selfSignedDomain) return;

      const container = await createWorker(request);
      try {
        const uniqueSub = `ss-tcp-${Date.now()}`;
        const { status, body } = await api.createDomainMapping({
          subdomain: uniqueSub,
          baseDomain: selfSignedDomain.domain,
          protocol: 'tcp',
          workerId: container.id,
          internalPort: 5432,
        });
        expect(status).toBe(201);
        expect(body.protocol).toBe('tcp');

        await api.deleteDomainMapping(body.id);
      } finally {
        await cleanupWorker(request, container.id);
      }
    });

    test('allows HTTP protocol on selfsigned domains', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (!mapperStatus.enabled) return;

      const selfSignedDomain = mapperStatus.baseDomainConfigs?.find(
        (c: { challengeType: string }) => c.challengeType === 'selfsigned'
      );

      if (!selfSignedDomain) return;

      const container = await createWorker(request);
      try {
        const uniqueSub = `ss-http-${Date.now()}`;
        const { status, body } = await api.createDomainMapping({
          subdomain: uniqueSub,
          baseDomain: selfSignedDomain.domain,
          protocol: 'http',
          workerId: container.id,
          internalPort: 8080,
        });
        expect(status).toBe(201);
        expect(body.protocol).toBe('http');

        await api.deleteDomainMapping(body.id);
      } finally {
        await cleanupWorker(request, container.id);
      }
    });

    test('creates and deletes mapping on selfsigned domain with basicAuth', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (!mapperStatus.enabled) return;

      const selfSignedDomain = mapperStatus.baseDomainConfigs?.find(
        (c: { challengeType: string }) => c.challengeType === 'selfsigned'
      );

      if (!selfSignedDomain) return;

      const container = await createWorker(request);
      try {
        const uniqueSub = `ss-auth-${Date.now()}`;
        const { status, body } = await api.createDomainMapping({
          subdomain: uniqueSub,
          baseDomain: selfSignedDomain.domain,
          protocol: 'https',
          workerId: container.id,
          internalPort: 8080,
          basicAuth: { username: 'admin', password: 'secret' },
        });
        expect(status).toBe(201);
        expect(body.basicAuth).toBeTruthy();
        expect(body.basicAuth.username).toBe('admin');

        // Verify it appears in list
        const { body: mappings } = await api.listDomainMappings();
        const found = mappings.find((m: { id: string }) => m.id === body.id);
        expect(found).toBeTruthy();

        // Delete and verify removal
        const { status: delStatus } = await api.deleteDomainMapping(body.id);
        expect(delStatus).toBe(200);

        const { body: afterDelete } = await api.listDomainMappings();
        expect(afterDelete.find((m: { id: string }) => m.id === body.id)).toBeUndefined();
      } finally {
        await cleanupWorker(request, container.id);
      }
    });
  });

  test.describe('Mixed challenge types', () => {
    test('status shows correct challengeType per domain', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.getDomainMapperStatus();

      if (!body.enabled) return;

      // Verify each domain has a valid challenge type
      for (const config of body.baseDomainConfigs || []) {
        expect(['none', 'http', 'dns', 'selfsigned']).toContain(config.challengeType);

        if (config.challengeType === 'dns') {
          expect(typeof config.dnsProvider).toBe('string');
          expect(config.dnsProvider.length).toBeGreaterThan(0);
        }

        if (config.challengeType === 'selfsigned') {
          expect(config.dnsProvider).toBeUndefined();
        }
      }
    });

    test('batch create works with selfsigned domains', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (!mapperStatus.enabled) return;

      const selfSignedDomain = mapperStatus.baseDomainConfigs?.find(
        (c: { challengeType: string }) => c.challengeType === 'selfsigned'
      );

      if (!selfSignedDomain) return;

      const container = await createWorker(request);
      try {
        const uniqueSub = `ss-batch-${Date.now()}`;
        const { status, body } = await api.createDomainMappingsBatch({
          items: [
            {
              subdomain: uniqueSub,
              baseDomain: selfSignedDomain.domain,
              protocol: 'http',
              workerId: container.id,
              internalPort: 8080,
            },
            {
              subdomain: uniqueSub,
              baseDomain: selfSignedDomain.domain,
              protocol: 'https',
              workerId: container.id,
              internalPort: 8080,
            },
          ],
        });
        expect(status).toBe(201);
        expect(Array.isArray(body)).toBe(true);
        expect(body).toHaveLength(2);

        // Clean up
        for (const m of body) {
          await api.deleteDomainMapping(m.id);
        }
      } finally {
        await cleanupWorker(request, container.id);
      }
    });
  });
});
