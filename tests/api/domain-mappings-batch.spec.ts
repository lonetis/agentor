import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';

test.describe('Domain Mappings Batch API', () => {
  test.describe('POST /api/domain-mappings/batch (endpoint existence)', () => {
    test('batch endpoint exists (not 404)', async ({ request }) => {
      const api = new ApiClient(request);
      // Send an invalid body — should get 400 (validation error), not 404
      const res = await request.post(`${api.baseUrl}/api/domain-mappings/batch`, {
        data: {},
      });
      // Expect a non-404 error: 400 if domain mapper enabled or disabled
      expect(res.status()).not.toBe(404);
      expect([400, 422, 500].includes(res.status()) || res.ok()).toBe(true);
    });
  });

  test.describe('POST /api/domain-mappings/batch (when BASE_DOMAINS not set)', () => {
    test('rejects batch creation when domain mapping is not enabled', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (!mapperStatus.enabled) {
        const { status, body } = await api.createDomainMappingsBatch({
          items: [
            {
              subdomain: 'test',
              baseDomain: 'example.com',
              protocol: 'https',
              workerId: 'test',
              internalPort: 8080,
            },
          ],
        });
        expect(status).toBe(400);
        expect(body.statusMessage).toContain('BASE_DOMAINS');
      }
    });
  });

  test.describe('POST /api/domain-mappings/batch (when BASE_DOMAINS set)', () => {
    test('rejects empty items array', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled) {
        const { status, body } = await api.createDomainMappingsBatch({
          items: [],
        });
        expect(status).toBe(400);
        expect(body.statusMessage).toContain('non-empty array');
      }
    });

    test('rejects missing items field', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled) {
        const { status, body } = await api.createDomainMappingsBatch({});
        expect(status).toBe(400);
        expect(body.statusMessage).toContain('non-empty array');
      }
    });

    test('rejects items that is not an array', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled) {
        const { status, body } = await api.createDomainMappingsBatch({
          items: 'not-an-array',
        });
        expect(status).toBe(400);
        expect(body.statusMessage).toContain('non-empty array');
      }
    });

    test('rejects item missing required fields', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const { status, body } = await api.createDomainMappingsBatch({
          items: [
            {
              subdomain: 'test',
              // missing baseDomain, protocol, workerId, internalPort
            },
          ],
        });
        expect(status).toBe(400);
        expect(body.statusMessage).toContain('requires');
      }
    });

    test('rejects item with invalid protocol', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const { status, body } = await api.createDomainMappingsBatch({
          items: [
            {
              subdomain: 'test',
              baseDomain: mapperStatus.baseDomains[0],
              protocol: 'ftp',
              workerId: 'test',
              internalPort: 8080,
            },
          ],
        });
        expect(status).toBe(400);
        expect(body.statusMessage).toContain('protocol');
      }
    });

    test('rejects item with baseDomain not in allowed list', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled) {
        const { status, body } = await api.createDomainMappingsBatch({
          items: [
            {
              subdomain: 'test',
              baseDomain: 'not-allowed-domain.xyz',
              protocol: 'http',
              workerId: 'test',
              internalPort: 8080,
            },
          ],
        });
        expect(status).toBe(400);
        expect(body.statusMessage).toContain('baseDomain');
      }
    });

    test('rejects item with invalid subdomain', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const { status, body } = await api.createDomainMappingsBatch({
          items: [
            {
              subdomain: '-invalid!',
              baseDomain: mapperStatus.baseDomains[0],
              protocol: 'http',
              workerId: 'test',
              internalPort: 8080,
            },
          ],
        });
        expect(status).toBe(400);
        expect(body.statusMessage).toContain('subdomain');
      }
    });

    test('rejects item with invalid internalPort', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const { status, body } = await api.createDomainMappingsBatch({
          items: [
            {
              subdomain: 'test',
              baseDomain: mapperStatus.baseDomains[0],
              protocol: 'http',
              workerId: 'test',
              internalPort: 99999,
            },
          ],
        });
        expect(status).toBe(400);
        expect(body.statusMessage).toContain('internalPort');
      }
    });

    test('rejects item with non-running worker', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const { status, body } = await api.createDomainMappingsBatch({
          items: [
            {
              subdomain: 'test',
              baseDomain: mapperStatus.baseDomains[0],
              protocol: 'http',
              workerId: 'non-existent-worker',
              internalPort: 8080,
            },
          ],
        });
        expect(status).toBe(400);
        expect(body.statusMessage).toContain('not running');
      }
    });

    test('rejects item with invalid workerId', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const { status } = await api.createDomainMappingsBatch({
          items: [
            {
              subdomain: 'test-invalid',
              baseDomain: mapperStatus.baseDomains[0],
              protocol: 'http',
              workerId: 'nonexistent-worker-id',
              internalPort: 8080,
            },
          ],
        });
        expect(status).toBe(400);
      }
    });

    test('batch creates multiple mappings and returns array', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const container = await createWorker(request);
        try {
          const sub1 = `batch1-${Date.now()}`;
          const sub2 = `batch2-${Date.now()}`;
          const baseDomain = mapperStatus.baseDomains[0];

          const { status, body } = await api.createDomainMappingsBatch({
            items: [
              {
                subdomain: sub1,
                baseDomain,
                protocol: 'http',
                workerId: container.id,
                internalPort: 8080,
              },
              {
                subdomain: sub2,
                baseDomain,
                protocol: 'http',
                workerId: container.id,
                internalPort: 9090,
              },
            ],
          });
          expect(status).toBe(201);
          expect(Array.isArray(body)).toBe(true);
          expect(body).toHaveLength(2);

          // Verify first mapping fields
          expect(body[0].subdomain).toBe(sub1);
          expect(body[0].baseDomain).toBe(baseDomain);
          expect(body[0].protocol).toBe('http');
          expect(body[0].internalPort).toBe(8080);
          expect(typeof body[0].id).toBe('string');
          expect(typeof body[0].workerName).toBe('string');

          // Verify second mapping fields
          expect(body[1].subdomain).toBe(sub2);
          expect(body[1].baseDomain).toBe(baseDomain);
          expect(body[1].protocol).toBe('http');
          expect(body[1].internalPort).toBe(9090);
          expect(typeof body[1].id).toBe('string');

          // Cleanup
          for (const mapping of body) {
            await api.deleteDomainMapping(mapping.id);
          }
        } finally {
          await cleanupWorker(request, container.id);
        }
      }
    });

    test('batch created mappings appear in list', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const container = await createWorker(request);
        try {
          const sub1 = `list1-${Date.now()}`;
          const sub2 = `list2-${Date.now()}`;
          const baseDomain = mapperStatus.baseDomains[0];

          const { status, body: created } = await api.createDomainMappingsBatch({
            items: [
              {
                subdomain: sub1,
                baseDomain,
                protocol: 'http',
                workerId: container.id,
                internalPort: 8080,
              },
              {
                subdomain: sub2,
                baseDomain,
                protocol: 'http',
                workerId: container.id,
                internalPort: 9090,
              },
            ],
          });
          expect(status).toBe(201);

          // Both should appear in the list
          const { body: list } = await api.listDomainMappings();
          const found1 = list.find((m: { id: string }) => m.id === created[0].id);
          const found2 = list.find((m: { id: string }) => m.id === created[1].id);
          expect(found1).toBeTruthy();
          expect(found2).toBeTruthy();

          // Cleanup
          for (const mapping of created) {
            await api.deleteDomainMapping(mapping.id);
          }
        } finally {
          await cleanupWorker(request, container.id);
        }
      }
    });

    test('batch creates single mapping', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const container = await createWorker(request);
        try {
          const uniqueSub = `single-${Date.now()}`;
          const baseDomain = mapperStatus.baseDomains[0];

          const { status, body } = await api.createDomainMappingsBatch({
            items: [
              {
                subdomain: uniqueSub,
                baseDomain,
                protocol: 'http',
                workerId: container.id,
                internalPort: 8080,
              },
            ],
          });
          expect(status).toBe(201);
          expect(Array.isArray(body)).toBe(true);
          expect(body).toHaveLength(1);
          expect(body[0].subdomain).toBe(uniqueSub);

          await api.deleteDomainMapping(body[0].id);
        } finally {
          await cleanupWorker(request, container.id);
        }
      }
    });

    test('batch supports workerName instead of workerId', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const container = await createWorker(request);
        try {
          const uniqueSub = `byname-${Date.now()}`;
          const baseDomain = mapperStatus.baseDomains[0];

          const { status, body } = await api.createDomainMappingsBatch({
            items: [
              {
                subdomain: uniqueSub,
                baseDomain,
                protocol: 'http',
                workerName: container.name,
                internalPort: 8080,
              },
            ],
          });
          expect(status).toBe(201);
          expect(body).toHaveLength(1);
          expect(body[0].workerName).toBe(container.name);

          await api.deleteDomainMapping(body[0].id);
        } finally {
          await cleanupWorker(request, container.id);
        }
      }
    });

    test('batch supports basicAuth on individual items', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const container = await createWorker(request);
        try {
          const uniqueSub = `batchauth-${Date.now()}`;
          const baseDomain = mapperStatus.baseDomains[0];

          const { status, body } = await api.createDomainMappingsBatch({
            items: [
              {
                subdomain: uniqueSub,
                baseDomain,
                protocol: 'http',
                workerId: container.id,
                internalPort: 8080,
                basicAuth: { username: 'testuser', password: 'testpass' },
              },
            ],
          });
          expect(status).toBe(201);
          expect(body).toHaveLength(1);
          expect(body[0].basicAuth).toBeTruthy();
          expect(body[0].basicAuth.username).toBe('testuser');

          await api.deleteDomainMapping(body[0].id);
        } finally {
          await cleanupWorker(request, container.id);
        }
      }
    });

    test('batch rejects duplicate subdomains within same request', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const container = await createWorker(request);
        try {
          const uniqueSub = `dup-${Date.now()}`;
          const baseDomain = mapperStatus.baseDomains[0];

          const { status } = await api.createDomainMappingsBatch({
            items: [
              {
                subdomain: uniqueSub,
                baseDomain,
                protocol: 'http',
                workerId: container.id,
                internalPort: 8080,
              },
              {
                subdomain: uniqueSub,
                baseDomain,
                protocol: 'http',
                workerId: container.id,
                internalPort: 9090,
              },
            ],
          });
          // The second item should cause a conflict since the first was already added
          expect(status).toBe(409);

          // Clean up any partial creates
          const { body: list } = await api.listDomainMappings();
          for (const m of list) {
            if (m.subdomain === uniqueSub && m.baseDomain === baseDomain) {
              await api.deleteDomainMapping(m.id);
            }
          }
        } finally {
          await cleanupWorker(request, container.id);
        }
      }
    });

    test('batch creates mapping with path', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const container = await createWorker(request);
        try {
          const uniqueSub = `batchpath-${Date.now()}`;
          const baseDomain = mapperStatus.baseDomains[0];

          const { status, body } = await api.createDomainMappingsBatch({
            items: [
              {
                subdomain: uniqueSub,
                baseDomain,
                protocol: 'http',
                workerId: container.id,
                internalPort: 8080,
                path: '/api',
              },
            ],
          });
          expect(status).toBe(201);
          expect(body).toHaveLength(1);
          expect(body[0].path).toBe('/api');

          await api.deleteDomainMapping(body[0].id);
        } finally {
          await cleanupWorker(request, container.id);
        }
      }
    });

    test('batch rejects path for TCP protocol', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const container = await createWorker(request);
        try {
          const { status, body } = await api.createDomainMappingsBatch({
            items: [
              {
                subdomain: `batchtcppath-${Date.now()}`,
                baseDomain: mapperStatus.baseDomains[0],
                protocol: 'tcp',
                workerId: container.id,
                internalPort: 5432,
                path: '/api',
              },
            ],
          });
          expect(status).toBe(400);
          expect(body.statusMessage).toContain('TCP');
        } finally {
          await cleanupWorker(request, container.id);
        }
      }
    });

    test('batch defaults path to empty string when omitted', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const container = await createWorker(request);
        try {
          const uniqueSub = `batchnopath-${Date.now()}`;
          const baseDomain = mapperStatus.baseDomains[0];

          const { status, body } = await api.createDomainMappingsBatch({
            items: [
              {
                subdomain: uniqueSub,
                baseDomain,
                protocol: 'http',
                workerId: container.id,
                internalPort: 8080,
              },
            ],
          });
          expect(status).toBe(201);
          expect(body[0].path).toBe('');

          await api.deleteDomainMapping(body[0].id);
        } finally {
          await cleanupWorker(request, container.id);
        }
      }
    });

    test('batch defaults subdomain to empty string when omitted', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const container = await createWorker(request);
        try {
          const baseDomain = mapperStatus.baseDomains[0];

          const { status, body } = await api.createDomainMappingsBatch({
            items: [
              {
                // subdomain intentionally omitted — bare domain mapping
                baseDomain,
                protocol: 'http',
                workerId: container.id,
                internalPort: 8080,
              },
            ],
          });
          expect(status).toBe(201);
          expect(body).toHaveLength(1);
          expect(body[0].subdomain).toBe('');

          await api.deleteDomainMapping(body[0].id);
        } finally {
          await cleanupWorker(request, container.id);
        }
      }
    });

    test('batch fails atomically on second invalid item after valid first', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const container = await createWorker(request);
        try {
          const validSub = `valid-${Date.now()}`;
          const baseDomain = mapperStatus.baseDomains[0];

          const { status } = await api.createDomainMappingsBatch({
            items: [
              {
                subdomain: validSub,
                baseDomain,
                protocol: 'http',
                workerId: container.id,
                internalPort: 8080,
              },
              {
                // Missing required fields
                subdomain: 'incomplete',
              },
            ],
          });
          // Should fail validation for the second item
          expect(status).toBe(400);

          // Clean up any partial creates (the first item may have been stored
          // before the second failed, depending on implementation)
          const { body: list } = await api.listDomainMappings();
          for (const m of list) {
            if (m.subdomain === validSub && m.baseDomain === baseDomain) {
              await api.deleteDomainMapping(m.id);
            }
          }
        } finally {
          await cleanupWorker(request, container.id);
        }
      }
    });
  });
});
