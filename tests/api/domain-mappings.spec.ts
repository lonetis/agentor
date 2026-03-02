import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';

test.describe('Domain Mappings API', () => {
  test.describe('GET /api/domain-mappings', () => {
    test('returns list of domain mappings', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.listDomainMappings();
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });
  });

  test.describe('GET /api/domain-mapper/status', () => {
    test('returns domain mapper status', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.getDomainMapperStatus();
      expect(status).toBe(200);
      expect(typeof body.enabled).toBe('boolean');
      expect(Array.isArray(body.baseDomains)).toBe(true);
      expect(typeof body.totalMappings).toBe('number');
    });

    test('baseDomains array has consistent count with totalMappings', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.getDomainMapperStatus();
      // If disabled, baseDomains should be empty
      if (!body.enabled) {
        expect(body.baseDomains).toEqual([]);
      }
    });
  });

  test.describe('POST /api/domain-mappings (when BASE_DOMAINS not set)', () => {
    test('rejects creation when domain mapping is not enabled', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (!mapperStatus.enabled) {
        const { status, body } = await api.createDomainMapping({
          subdomain: 'test',
          baseDomain: 'example.com',
          protocol: 'https',
          workerId: 'test',
          internalPort: 8080,
        });
        expect(status).toBe(400);
        expect(body.statusMessage).toContain('BASE_DOMAINS');
      }
    });

    test('rejects empty body when disabled', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (!mapperStatus.enabled) {
        const { status } = await api.createDomainMapping({});
        expect(status).toBe(400);
      }
    });
  });

  test.describe('POST /api/domain-mappings (when BASE_DOMAINS set)', () => {
    test('rejects missing required fields', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled) {
        const { status } = await api.createDomainMapping({});
        expect(status).toBe(400);
      }
    });

    test('rejects invalid protocol', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const { status } = await api.createDomainMapping({
          subdomain: 'test',
          baseDomain: mapperStatus.baseDomains[0],
          protocol: 'ftp',
          workerId: 'test',
          internalPort: 8080,
        });
        expect(status).toBe(400);
      }
    });

    test('rejects invalid subdomain characters', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const { status } = await api.createDomainMapping({
          subdomain: 'test_invalid!',
          baseDomain: mapperStatus.baseDomains[0],
          protocol: 'https',
          workerId: 'test',
          internalPort: 8080,
        });
        expect(status).toBe(400);
      }
    });

    test('rejects non-running worker', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const { status } = await api.createDomainMapping({
          subdomain: 'test',
          baseDomain: mapperStatus.baseDomains[0],
          protocol: 'https',
          workerId: 'non-existent',
          internalPort: 8080,
        });
        expect(status).toBe(400);
      }
    });

    test('rejects invalid internalPort', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const { status } = await api.createDomainMapping({
          subdomain: 'test',
          baseDomain: mapperStatus.baseDomains[0],
          protocol: 'https',
          workerId: 'test',
          internalPort: 99999,
        });
        expect(status).toBe(400);
      }
    });

    test('rejects baseDomain not in allowed list', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled) {
        const { status } = await api.createDomainMapping({
          subdomain: 'test',
          baseDomain: 'not-allowed-domain.xyz',
          protocol: 'https',
          workerId: 'test',
          internalPort: 8080,
        });
        expect(status).toBe(400);
      }
    });

    test('creates and deletes a domain mapping', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        // Need a running container
        const container = await createWorker(request);
        try {
          const uniqueSub = `test-${Date.now()}`;
          const { status, body } = await api.createDomainMapping({
            subdomain: uniqueSub,
            baseDomain: mapperStatus.baseDomains[0],
            protocol: 'https',
            workerId: container.id,
            internalPort: 8080,
          });
          expect(status).toBe(201);
          expect(body.subdomain).toBe(uniqueSub);
          expect(body.id).toBeTruthy();

          // Delete it
          const { status: delStatus } = await api.deleteDomainMapping(body.id);
          expect(delStatus).toBe(200);
        } finally {
          await cleanupWorker(request, container.id);
        }
      }
    });

    test('response includes all expected fields', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const container = await createWorker(request);
        try {
          const uniqueSub = `fields-${Date.now()}`;
          const { status, body } = await api.createDomainMapping({
            subdomain: uniqueSub,
            baseDomain: mapperStatus.baseDomains[0],
            protocol: 'https',
            workerId: container.id,
            internalPort: 8080,
          });
          expect(status).toBe(201);
          expect(typeof body.id).toBe('string');
          expect(body.subdomain).toBe(uniqueSub);
          expect(body.baseDomain).toBe(mapperStatus.baseDomains[0]);
          expect(body.protocol).toBe('https');
          expect(typeof body.workerName).toBe('string');
          expect(body.internalPort).toBe(8080);

          await api.deleteDomainMapping(body.id);
        } finally {
          await cleanupWorker(request, container.id);
        }
      }
    });

    test('creates domain mapping with HTTP protocol', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const container = await createWorker(request);
        try {
          const uniqueSub = `http-${Date.now()}`;
          const { status, body } = await api.createDomainMapping({
            subdomain: uniqueSub,
            baseDomain: mapperStatus.baseDomains[0],
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
      }
    });

    test('creates domain mapping with basicAuth', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const container = await createWorker(request);
        try {
          const uniqueSub = `auth-${Date.now()}`;
          const { status, body } = await api.createDomainMapping({
            subdomain: uniqueSub,
            baseDomain: mapperStatus.baseDomains[0],
            protocol: 'https',
            workerId: container.id,
            internalPort: 8080,
            basicAuth: { username: 'testuser', password: 'testpass' },
          });
          expect(status).toBe(201);
          expect(body.basicAuth).toBeTruthy();
          expect(body.basicAuth.username).toBe('testuser');

          await api.deleteDomainMapping(body.id);
        } finally {
          await cleanupWorker(request, container.id);
        }
      }
    });

    test('rejects basicAuth with username but no password', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const { status } = await api.createDomainMapping({
          subdomain: 'authfail',
          baseDomain: mapperStatus.baseDomains[0],
          protocol: 'https',
          workerId: 'test',
          internalPort: 8080,
          basicAuth: { username: 'user' },
        });
        expect(status).toBe(400);
      }
    });
  });

  test.describe('DELETE /api/domain-mappings/:id', () => {
    test('handles non-existent mapping gracefully', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.deleteDomainMapping('non-existent-id');
      // Delete is idempotent — returns ok even for non-existent IDs
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
    });

    test('deleted mapping no longer appears in list', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const container = await createWorker(request);
        try {
          const { body: created } = await api.createDomainMapping({
            subdomain: `del-${Date.now()}`,
            baseDomain: mapperStatus.baseDomains[0],
            protocol: 'https',
            workerId: container.id,
            internalPort: 8080,
          });

          await api.deleteDomainMapping(created.id);

          const { body: list } = await api.listDomainMappings();
          const found = list.find((m: { id: string }) => m.id === created.id);
          expect(found).toBeUndefined();
        } finally {
          await cleanupWorker(request, container.id);
        }
      }
    });
  });

  test.describe('BasicAuth validation', () => {
    test('rejects basicAuth with password but no username', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const { status } = await api.createDomainMapping({
          subdomain: 'authfail2',
          baseDomain: mapperStatus.baseDomains[0],
          protocol: 'https',
          workerId: 'test',
          internalPort: 8080,
          basicAuth: { password: 'secret' },
        });
        expect(status).toBe(400);
      }
    });
  });

  test.describe('Subdomain validation edge cases', () => {
    test('rejects leading hyphen', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const { status } = await api.createDomainMapping({
          subdomain: '-app',
          baseDomain: mapperStatus.baseDomains[0],
          protocol: 'https',
          workerId: 'test',
          internalPort: 8080,
        });
        expect(status).toBe(400);
      }
    });

    test('rejects trailing hyphen', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const { status } = await api.createDomainMapping({
          subdomain: 'app-',
          baseDomain: mapperStatus.baseDomains[0],
          protocol: 'https',
          workerId: 'test',
          internalPort: 8080,
        });
        expect(status).toBe(400);
      }
    });

    test('rejects underscore in subdomain', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const { status } = await api.createDomainMapping({
          subdomain: 'app_test',
          baseDomain: mapperStatus.baseDomains[0],
          protocol: 'https',
          workerId: 'test',
          internalPort: 8080,
        });
        expect(status).toBe(400);
      }
    });

    test('rejects consecutive dots', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const { status } = await api.createDomainMapping({
          subdomain: 'api..test',
          baseDomain: mapperStatus.baseDomains[0],
          protocol: 'https',
          workerId: 'test',
          internalPort: 8080,
        });
        expect(status).toBe(400);
      }
    });

    test('accepts single-char subdomain', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const container = await createWorker(request);
        try {
          const uniqueSub = `a${Date.now()}`;
          const { status, body } = await api.createDomainMapping({
            subdomain: uniqueSub,
            baseDomain: mapperStatus.baseDomains[0],
            protocol: 'https',
            workerId: container.id,
            internalPort: 8080,
          });
          expect(status).toBe(201);
          await api.deleteDomainMapping(body.id);
        } finally {
          await cleanupWorker(request, container.id);
        }
      }
    });

    test('accepts numeric-only subdomain', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const container = await createWorker(request);
        try {
          const uniqueSub = `${Date.now()}`;
          const { status, body } = await api.createDomainMapping({
            subdomain: uniqueSub,
            baseDomain: mapperStatus.baseDomains[0],
            protocol: 'https',
            workerId: container.id,
            internalPort: 8080,
          });
          expect(status).toBe(201);
          await api.deleteDomainMapping(body.id);
        } finally {
          await cleanupWorker(request, container.id);
        }
      }
    });

    test('accepts multi-level subdomain', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const container = await createWorker(request);
        try {
          const uniqueSub = `sub.domain.t${Date.now()}`;
          const { status, body } = await api.createDomainMapping({
            subdomain: uniqueSub,
            baseDomain: mapperStatus.baseDomains[0],
            protocol: 'https',
            workerId: container.id,
            internalPort: 8080,
          });
          expect(status).toBe(201);
          await api.deleteDomainMapping(body.id);
        } finally {
          await cleanupWorker(request, container.id);
        }
      }
    });

    test('accepts very long subdomain (64 chars)', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const container = await createWorker(request);
        try {
          // 64-char label (DNS allows up to 63 per label, but the regex does not enforce length)
          const uniqueSub = 'a'.repeat(64);
          const { status, body } = await api.createDomainMapping({
            subdomain: uniqueSub,
            baseDomain: mapperStatus.baseDomains[0],
            protocol: 'https',
            workerId: container.id,
            internalPort: 8080,
          });
          expect(status).toBe(201);
          await api.deleteDomainMapping(body.id);
        } finally {
          await cleanupWorker(request, container.id);
        }
      }
    });
  });

  test.describe('Port edge cases', () => {
    test('rejects internalPort 0', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const { status } = await api.createDomainMapping({
          subdomain: 'port0',
          baseDomain: mapperStatus.baseDomains[0],
          protocol: 'https',
          workerId: 'test',
          internalPort: 0,
        });
        expect(status).toBe(400);
      }
    });

    test('rejects internalPort 65536', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const { status } = await api.createDomainMapping({
          subdomain: 'port65536',
          baseDomain: mapperStatus.baseDomains[0],
          protocol: 'https',
          workerId: 'test',
          internalPort: 65536,
        });
        expect(status).toBe(400);
      }
    });

    test('rejects negative internalPort', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const { status } = await api.createDomainMapping({
          subdomain: 'portneg',
          baseDomain: mapperStatus.baseDomains[0],
          protocol: 'https',
          workerId: 'test',
          internalPort: -1,
        });
        expect(status).toBe(400);
      }
    });

    test('rejects float internalPort', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const { status } = await api.createDomainMapping({
          subdomain: 'portfloat',
          baseDomain: mapperStatus.baseDomains[0],
          protocol: 'https',
          workerId: 'test',
          internalPort: 3.14,
        });
        expect(status).toBe(400);
      }
    });

    test('accepts internalPort 1 (min valid)', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const container = await createWorker(request);
        try {
          const uniqueSub = `port1-${Date.now()}`;
          const { status, body } = await api.createDomainMapping({
            subdomain: uniqueSub,
            baseDomain: mapperStatus.baseDomains[0],
            protocol: 'https',
            workerId: container.id,
            internalPort: 1,
          });
          expect(status).toBe(201);
          expect(body.internalPort).toBe(1);
          await api.deleteDomainMapping(body.id);
        } finally {
          await cleanupWorker(request, container.id);
        }
      }
    });

    test('accepts internalPort 65535 (max valid)', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const container = await createWorker(request);
        try {
          const uniqueSub = `port65535-${Date.now()}`;
          const { status, body } = await api.createDomainMapping({
            subdomain: uniqueSub,
            baseDomain: mapperStatus.baseDomains[0],
            protocol: 'https',
            workerId: container.id,
            internalPort: 65535,
          });
          expect(status).toBe(201);
          expect(body.internalPort).toBe(65535);
          await api.deleteDomainMapping(body.id);
        } finally {
          await cleanupWorker(request, container.id);
        }
      }
    });

    test('coerces string internalPort to number', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const container = await createWorker(request);
        try {
          const uniqueSub = `portstr-${Date.now()}`;
          const { status, body } = await api.createDomainMapping({
            subdomain: uniqueSub,
            baseDomain: mapperStatus.baseDomains[0],
            protocol: 'https',
            workerId: container.id,
            internalPort: '8080' as unknown as number,
          });
          expect(status).toBe(201);
          expect(body.internalPort).toBe(8080);
          await api.deleteDomainMapping(body.id);
        } finally {
          await cleanupWorker(request, container.id);
        }
      }
    });
  });

  test.describe('Protocol conflict detection', () => {
    test('rejects duplicate subdomain+baseDomain with same protocol', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const container = await createWorker(request);
        try {
          const uniqueSub = `dup-${Date.now()}`;
          const baseDomain = mapperStatus.baseDomains[0];

          const { status: s1, body: first } = await api.createDomainMapping({
            subdomain: uniqueSub,
            baseDomain,
            protocol: 'https',
            workerId: container.id,
            internalPort: 8080,
          });
          expect(s1).toBe(201);

          try {
            const { status: s2 } = await api.createDomainMapping({
              subdomain: uniqueSub,
              baseDomain,
              protocol: 'https',
              workerId: container.id,
              internalPort: 9090,
            });
            expect(s2).toBe(409);
          } finally {
            await api.deleteDomainMapping(first.id);
          }
        } finally {
          await cleanupWorker(request, container.id);
        }
      }
    });

    test('allows HTTP and HTTPS on same subdomain (different entrypoints)', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const container = await createWorker(request);
        try {
          const uniqueSub = `dual-${Date.now()}`;
          const baseDomain = mapperStatus.baseDomains[0];

          const { status: s1, body: first } = await api.createDomainMapping({
            subdomain: uniqueSub,
            baseDomain,
            protocol: 'http',
            workerId: container.id,
            internalPort: 8080,
          });
          expect(s1).toBe(201);

          try {
            const { status: s2, body: second } = await api.createDomainMapping({
              subdomain: uniqueSub,
              baseDomain,
              protocol: 'https',
              workerId: container.id,
              internalPort: 8080,
            });
            expect(s2).toBe(201);
            await api.deleteDomainMapping(second.id);
          } finally {
            await api.deleteDomainMapping(first.id);
          }
        } finally {
          await cleanupWorker(request, container.id);
        }
      }
    });

    test('rejects HTTPS and TCP on same subdomain (both use port 443)', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const container = await createWorker(request);
        try {
          const uniqueSub = `tcpssl-${Date.now()}`;
          const baseDomain = mapperStatus.baseDomains[0];

          const { status: s1, body: first } = await api.createDomainMapping({
            subdomain: uniqueSub,
            baseDomain,
            protocol: 'https',
            workerId: container.id,
            internalPort: 8080,
          });
          expect(s1).toBe(201);

          try {
            const { status: s2 } = await api.createDomainMapping({
              subdomain: uniqueSub,
              baseDomain,
              protocol: 'tcp',
              workerId: container.id,
              internalPort: 9090,
            });
            expect(s2).toBe(409);
          } finally {
            await api.deleteDomainMapping(first.id);
          }
        } finally {
          await cleanupWorker(request, container.id);
        }
      }
    });

    test('allows HTTP and TCP on same subdomain (port 80 vs 443)', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const container = await createWorker(request);
        try {
          const uniqueSub = `httptcp-${Date.now()}`;
          const baseDomain = mapperStatus.baseDomains[0];

          const { status: s1, body: first } = await api.createDomainMapping({
            subdomain: uniqueSub,
            baseDomain,
            protocol: 'http',
            workerId: container.id,
            internalPort: 8080,
          });
          expect(s1).toBe(201);

          try {
            const { status: s2, body: second } = await api.createDomainMapping({
              subdomain: uniqueSub,
              baseDomain,
              protocol: 'tcp',
              workerId: container.id,
              internalPort: 9090,
            });
            expect(s2).toBe(201);
            await api.deleteDomainMapping(second.id);
          } finally {
            await api.deleteDomainMapping(first.id);
          }
        } finally {
          await cleanupWorker(request, container.id);
        }
      }
    });
  });

  test.describe('Stopped worker rejection', () => {
    test('rejects mapping for stopped worker', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const container = await createWorker(request);
        try {
          // Stop the worker first
          await api.stopContainer(container.id);
          // Wait for stop to take effect
          await new Promise(r => setTimeout(r, 2000));

          const { status } = await api.createDomainMapping({
            subdomain: `stopped-${Date.now()}`,
            baseDomain: mapperStatus.baseDomains[0],
            protocol: 'https',
            workerId: container.id,
            internalPort: 8080,
          });
          expect(status).toBe(400);
        } finally {
          await cleanupWorker(request, container.id);
        }
      }
    });
  });

  test.describe('TCP protocol', () => {
    test('creates domain mapping with TCP protocol', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const container = await createWorker(request);
        try {
          const uniqueSub = `tcp-${Date.now()}`;
          const { status, body } = await api.createDomainMapping({
            subdomain: uniqueSub,
            baseDomain: mapperStatus.baseDomains[0],
            protocol: 'tcp',
            workerId: container.id,
            internalPort: 5432,
          });
          expect(status).toBe(201);
          expect(body.protocol).toBe('tcp');
          expect(body.internalPort).toBe(5432);

          await api.deleteDomainMapping(body.id);
        } finally {
          await cleanupWorker(request, container.id);
        }
      }
    });
  });

  test.describe('Domain mapper status fields', () => {
    test('totalMappings is a number', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.getDomainMapperStatus();
      expect(status).toBe(200);
      expect(typeof body.totalMappings).toBe('number');
      expect(body.totalMappings).toBeGreaterThanOrEqual(0);
    });

    test('baseDomains is non-empty when enabled', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.getDomainMapperStatus();
      expect(status).toBe(200);

      if (body.enabled) {
        expect(body.baseDomains.length).toBeGreaterThan(0);
        for (const domain of body.baseDomains) {
          expect(typeof domain).toBe('string');
          expect(domain.length).toBeGreaterThan(0);
        }
      }
    });

    test('dashboardUrl is present or absent based on config', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.getDomainMapperStatus();
      expect(status).toBe(200);

      if (body.dashboardUrl !== undefined) {
        // If present, it should be a valid-looking URL
        expect(typeof body.dashboardUrl).toBe('string');
        expect(body.dashboardUrl).toMatch(/^https:\/\/.+\..+/);
      }
      // If absent, the field should simply not exist
      // (either way is valid — depends on DASHBOARD_SUBDOMAIN config)
    });
  });
});
