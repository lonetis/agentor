import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';

test.describe('Domain Mappings API — Advanced', () => {
  const createdContainerIds: string[] = [];

  test.afterEach(async ({ request }) => {
    // Clean up domain mappings only for our workers (not globally — avoids parallel interference)
    const api = new ApiClient(request);
    const { body: mappings } = await api.listDomainMappings();
    for (const m of mappings) {
      if (createdContainerIds.includes(m.workerId)) {
        try { await api.deleteDomainMapping(m.id); } catch { /* ignore */ }
      }
    }
    for (const id of createdContainerIds) {
      await cleanupWorker(request, id);
    }
    createdContainerIds.length = 0;
  });

  test.describe('Domain mapper status', () => {
    test('returns status with enabled and baseDomains fields', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.getDomainMapperStatus();
      expect(status).toBe(200);
      expect(typeof body.enabled).toBe('boolean');
      expect(Array.isArray(body.baseDomains)).toBe(true);
    });
  });

  test.describe('Protocol conflicts', () => {
    test('rejects duplicate protocol on same subdomain+baseDomain', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: statusBody } = await api.getDomainMapperStatus();

      // Skip if domain mapping is not enabled
      if (!statusBody.enabled || statusBody.baseDomains.length === 0) {
        test.skip();
        return;
      }

      // Use a unique subdomain per attempt — under contention the cleanup
      // can fail silently and a stale mapping from a previous attempt
      // would make the FIRST create return 409 instead of 201.
      const dupSub = `t-dup-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const baseDomain = statusBody.baseDomains[0];
      const container = await createWorker(request);
      createdContainerIds.push(container.id);

      // Create first mapping
      const { status: firstStatus } = await api.createDomainMapping({
        subdomain: dupSub,
        baseDomain,
        protocol: 'https',
        workerId: container.id,
        workerName: container.name,
        internalPort: 8080,
      });
      expect(firstStatus).toBe(201);

      // Same subdomain+baseDomain+protocol should fail
      const { status: dupStatus } = await api.createDomainMapping({
        subdomain: dupSub,
        baseDomain,
        protocol: 'https',
        workerId: container.id,
        workerName: container.name,
        internalPort: 9090,
      });
      expect(dupStatus).toBeGreaterThanOrEqual(400);
    });

    test('rejects HTTPS+TCP on same subdomain (both use port 443)', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: statusBody } = await api.getDomainMapperStatus();

      if (!statusBody.enabled || statusBody.baseDomains.length === 0) {
        test.skip();
        return;
      }

      const confSub = `t-conf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const baseDomain = statusBody.baseDomains[0];
      const container = await createWorker(request);
      createdContainerIds.push(container.id);

      const { status: httpsStatus } = await api.createDomainMapping({
        subdomain: confSub,
        baseDomain,
        protocol: 'https',
        workerId: container.id,
        workerName: container.name,
        internalPort: 8080,
      });
      expect(httpsStatus).toBe(201);

      const { status: tcpStatus } = await api.createDomainMapping({
        subdomain: confSub,
        baseDomain,
        protocol: 'tcp',
        workerId: container.id,
        workerName: container.name,
        internalPort: 9090,
      });
      expect(tcpStatus).toBeGreaterThanOrEqual(400);
    });

    test('allows same subdomain on different base domains', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: statusBody } = await api.getDomainMapperStatus();

      if (!statusBody.enabled || statusBody.baseDomains.length < 2) {
        test.skip();
        return;
      }

      const multiSub = `t-multi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const container = await createWorker(request);
      createdContainerIds.push(container.id);

      const { status: first } = await api.createDomainMapping({
        subdomain: multiSub,
        baseDomain: statusBody.baseDomains[0],
        protocol: 'https',
        workerId: container.id,
        workerName: container.name,
        internalPort: 8080,
      });
      expect(first).toBe(201);

      const { status: second } = await api.createDomainMapping({
        subdomain: multiSub,
        baseDomain: statusBody.baseDomains[1],
        protocol: 'https',
        workerId: container.id,
        workerName: container.name,
        internalPort: 8080,
      });
      expect(second).toBe(201);
    });
  });

  test.describe('Basic auth', () => {
    test('creates mapping with basic auth', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: statusBody } = await api.getDomainMapperStatus();

      if (!statusBody.enabled || statusBody.baseDomains.length === 0) {
        test.skip();
        return;
      }

      const authSub = `t-auth-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const container = await createWorker(request);
      createdContainerIds.push(container.id);

      const { status, body } = await api.createDomainMapping({
        subdomain: authSub,
        baseDomain: statusBody.baseDomains[0],
        protocol: 'https',
        workerId: container.id,
        workerName: container.name,
        internalPort: 8080,
        basicAuth: {
          username: 'testuser',
          password: 'testpass',
        },
      });
      expect(status).toBe(201);
      expect(body.basicAuth).toBeTruthy();
      expect(body.basicAuth.username).toBe('testuser');
    });
  });
});
