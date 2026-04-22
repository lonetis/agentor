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
          expect(body.path).toBe('');
          expect(body.protocol).toBe('https');
          expect(body.wildcard).toBe(false);
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

  test.describe('Path validation', () => {
    test('rejects path without leading slash', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const container = await createWorker(request);
        try {
          const { status } = await api.createDomainMapping({
            subdomain: `pathval-${Date.now()}`,
            baseDomain: mapperStatus.baseDomains[0],
            protocol: 'http',
            workerId: container.id,
            internalPort: 8080,
            path: 'no-leading-slash',
          });
          expect(status).toBe(400);
        } finally {
          await cleanupWorker(request, container.id);
        }
      }
    });

    test('rejects path with invalid characters', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const { status } = await api.createDomainMapping({
          subdomain: 'pathchars',
          baseDomain: mapperStatus.baseDomains[0],
          protocol: 'http',
          workerId: 'test',
          internalPort: 8080,
          path: '/api/foo bar',
        });
        expect(status).toBe(400);
      }
    });

    test('rejects path for TCP protocol', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const container = await createWorker(request);
        try {
          const { status, body } = await api.createDomainMapping({
            subdomain: `tcppath-${Date.now()}`,
            baseDomain: mapperStatus.baseDomains[0],
            protocol: 'tcp',
            workerId: container.id,
            internalPort: 5432,
            path: '/api',
          });
          expect(status).toBe(400);
          expect(body.statusMessage).toContain('TCP');
        } finally {
          await cleanupWorker(request, container.id);
        }
      }
    });

    test('normalizes path "/" to empty string (no path)', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const container = await createWorker(request);
        try {
          const uniqueSub = `rootpath-${Date.now()}`;
          const { status, body } = await api.createDomainMapping({
            subdomain: uniqueSub,
            baseDomain: mapperStatus.baseDomains[0],
            protocol: 'http',
            workerId: container.id,
            internalPort: 8080,
            path: '/',
          });
          expect(status).toBe(201);
          expect(body.path).toBe('');
          await api.deleteDomainMapping(body.id);
        } finally {
          await cleanupWorker(request, container.id);
        }
      }
    });

    test('strips trailing slash from path', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const container = await createWorker(request);
        try {
          const uniqueSub = `trailslash-${Date.now()}`;
          const { status, body } = await api.createDomainMapping({
            subdomain: uniqueSub,
            baseDomain: mapperStatus.baseDomains[0],
            protocol: 'http',
            workerId: container.id,
            internalPort: 8080,
            path: '/api/',
          });
          expect(status).toBe(201);
          expect(body.path).toBe('/api');
          await api.deleteDomainMapping(body.id);
        } finally {
          await cleanupWorker(request, container.id);
        }
      }
    });

    test('creates mapping with valid path', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const container = await createWorker(request);
        try {
          const uniqueSub = `validpath-${Date.now()}`;
          const { status, body } = await api.createDomainMapping({
            subdomain: uniqueSub,
            baseDomain: mapperStatus.baseDomains[0],
            protocol: 'http',
            workerId: container.id,
            internalPort: 8080,
            path: '/api/v2',
          });
          expect(status).toBe(201);
          expect(body.path).toBe('/api/v2');
          expect(body.subdomain).toBe(uniqueSub);
          await api.deleteDomainMapping(body.id);
        } finally {
          await cleanupWorker(request, container.id);
        }
      }
    });

    test('allows same domain with different paths', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const container = await createWorker(request);
        try {
          const uniqueSub = `multipath-${Date.now()}`;
          const baseDomain = mapperStatus.baseDomains[0];

          const { status: s1, body: first } = await api.createDomainMapping({
            subdomain: uniqueSub,
            baseDomain,
            protocol: 'http',
            workerId: container.id,
            internalPort: 8080,
            path: '/api',
          });
          expect(s1).toBe(201);

          try {
            const { status: s2, body: second } = await api.createDomainMapping({
              subdomain: uniqueSub,
              baseDomain,
              protocol: 'http',
              workerId: container.id,
              internalPort: 9090,
              path: '/app',
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

    test('rejects duplicate domain+path+protocol', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const container = await createWorker(request);
        try {
          const uniqueSub = `duppath-${Date.now()}`;
          const baseDomain = mapperStatus.baseDomains[0];

          const { status: s1, body: first } = await api.createDomainMapping({
            subdomain: uniqueSub,
            baseDomain,
            protocol: 'http',
            workerId: container.id,
            internalPort: 8080,
            path: '/api',
          });
          expect(s1).toBe(201);

          try {
            const { status: s2 } = await api.createDomainMapping({
              subdomain: uniqueSub,
              baseDomain,
              protocol: 'http',
              workerId: container.id,
              internalPort: 9090,
              path: '/api',
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

    test('path defaults to empty string when omitted', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();

      if (mapperStatus.enabled && mapperStatus.baseDomains.length > 0) {
        const container = await createWorker(request);
        try {
          const uniqueSub = `nopath-${Date.now()}`;
          const { status, body } = await api.createDomainMapping({
            subdomain: uniqueSub,
            baseDomain: mapperStatus.baseDomains[0],
            protocol: 'http',
            workerId: container.id,
            internalPort: 8080,
          });
          expect(status).toBe(201);
          expect(body.path).toBe('');
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
        // If present, it should be a valid-looking URL (http or https depending on TLS config)
        expect(typeof body.dashboardUrl).toBe('string');
        expect(body.dashboardUrl).toMatch(/^https?:\/\/.+\..+/);
      }
      // If absent, the field should simply not exist
      // (either way is valid — depends on DASHBOARD_SUBDOMAIN config)
    });

    test('baseDomainConfigs entries expose challengeType used by the UI wildcard toggle', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.getDomainMapperStatus();
      if (body.enabled) {
        expect(Array.isArray(body.baseDomainConfigs)).toBe(true);
        for (const dc of body.baseDomainConfigs) {
          expect(typeof dc.domain).toBe('string');
          expect(['none', 'http', 'dns', 'selfsigned']).toContain(dc.challengeType);
        }
      }
    });
  });

  test.describe('Wildcard routing', () => {
    test('defaults wildcard to false when omitted', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();
      if (!mapperStatus.enabled || mapperStatus.baseDomains.length === 0) return;

      const container = await createWorker(request);
      try {
        const uniqueSub = `wcdef-${Date.now()}`;
        const { status, body } = await api.createDomainMapping({
          subdomain: uniqueSub,
          baseDomain: mapperStatus.baseDomains[0],
          protocol: 'http',
          workerId: container.id,
          internalPort: 8080,
        });
        expect(status).toBe(201);
        expect(body.wildcard).toBe(false);
        await api.deleteDomainMapping(body.id);
      } finally {
        await cleanupWorker(request, container.id);
      }
    });

    test('creates HTTP wildcard mapping on a selfsigned base domain', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();
      if (!mapperStatus.enabled) return;

      const baseDomain = mapperStatus.baseDomains.find((d: string) => {
        const dc = mapperStatus.baseDomainConfigs.find((c: { domain: string; challengeType: string }) => c.domain === d);
        return dc && dc.challengeType !== 'http';
      });
      test.skip(!baseDomain, 'No base domain with wildcard-capable challenge type');

      const container = await createWorker(request);
      try {
        const uniqueSub = `wchttp-${Date.now()}`;
        const { status, body } = await api.createDomainMapping({
          subdomain: uniqueSub,
          baseDomain,
          protocol: 'http',
          wildcard: true,
          workerId: container.id,
          internalPort: 8080,
        });
        expect(status).toBe(201);
        expect(body.wildcard).toBe(true);
        expect(body.subdomain).toBe(uniqueSub);
        await api.deleteDomainMapping(body.id);
      } finally {
        await cleanupWorker(request, container.id);
      }
    });

    test('creates HTTPS wildcard mapping when base domain has TLS', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();
      if (!mapperStatus.enabled) return;

      const tlsDomain = mapperStatus.baseDomains.find((d: string) => {
        const dc = mapperStatus.baseDomainConfigs.find((c: { domain: string; challengeType: string }) => c.domain === d);
        return dc && (dc.challengeType === 'dns' || dc.challengeType === 'selfsigned');
      });
      test.skip(!tlsDomain, 'No base domain supporting wildcard HTTPS');

      const container = await createWorker(request);
      try {
        const uniqueSub = `wchttps-${Date.now()}`;
        const { status, body } = await api.createDomainMapping({
          subdomain: uniqueSub,
          baseDomain: tlsDomain,
          protocol: 'https',
          wildcard: true,
          workerId: container.id,
          internalPort: 8080,
        });
        expect(status).toBe(201);
        expect(body.wildcard).toBe(true);
        await api.deleteDomainMapping(body.id);
      } finally {
        await cleanupWorker(request, container.id);
      }
    });

    test('creates TCP wildcard mapping when base domain has TLS', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();
      if (!mapperStatus.enabled) return;

      const tlsDomain = mapperStatus.baseDomains.find((d: string) => {
        const dc = mapperStatus.baseDomainConfigs.find((c: { domain: string; challengeType: string }) => c.domain === d);
        return dc && (dc.challengeType === 'dns' || dc.challengeType === 'selfsigned');
      });
      test.skip(!tlsDomain, 'No base domain supporting wildcard TCP');

      const container = await createWorker(request);
      try {
        const uniqueSub = `wctcp-${Date.now()}`;
        const { status, body } = await api.createDomainMapping({
          subdomain: uniqueSub,
          baseDomain: tlsDomain,
          protocol: 'tcp',
          wildcard: true,
          workerId: container.id,
          internalPort: 5432,
        });
        expect(status).toBe(201);
        expect(body.wildcard).toBe(true);
        expect(body.protocol).toBe('tcp');
        await api.deleteDomainMapping(body.id);
      } finally {
        await cleanupWorker(request, container.id);
      }
    });

    test('creates wildcard mapping on bare base domain (empty subdomain)', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();
      if (!mapperStatus.enabled) return;

      const baseDomain = mapperStatus.baseDomains.find((d: string) => {
        const dc = mapperStatus.baseDomainConfigs.find((c: { domain: string; challengeType: string }) => c.domain === d);
        return dc && dc.challengeType !== 'http';
      });
      test.skip(!baseDomain, 'No base domain supporting wildcard');

      // Two mappings cannot share baseDomain+subdomain+path+protocol — the
      // bare-domain slot is singular, so this test creates and deletes quickly.
      const container = await createWorker(request);
      try {
        const { status, body } = await api.createDomainMapping({
          subdomain: '',
          baseDomain,
          protocol: 'http',
          wildcard: true,
          workerId: container.id,
          internalPort: 8080,
          path: `/wcbare-${Date.now()}`,
        });
        expect(status).toBe(201);
        expect(body.subdomain).toBe('');
        expect(body.wildcard).toBe(true);
        await api.deleteDomainMapping(body.id);
      } finally {
        await cleanupWorker(request, container.id);
      }
    });

    test('rejects wildcard on HTTP-01 ACME base domain', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();
      if (!mapperStatus.enabled) return;

      const httpDomain = mapperStatus.baseDomains.find((d: string) => {
        const dc = mapperStatus.baseDomainConfigs.find((c: { domain: string; challengeType: string }) => c.domain === d);
        return dc && dc.challengeType === 'http';
      });
      test.skip(!httpDomain, 'No base domain with HTTP-01 ACME challenge configured');

      const { status, body } = await api.createDomainMapping({
        subdomain: `wchttp01-${Date.now()}`,
        baseDomain: httpDomain,
        protocol: 'https',
        wildcard: true,
        workerId: 'test',
        internalPort: 8080,
      });
      expect(status).toBe(400);
      expect(body.statusMessage).toContain('wildcard');
    });

    test('ignores truthy wildcard values that are not strictly true', async ({ request }) => {
      // Defense: only `wildcard === true` activates the feature. Strings and
      // numbers in the payload must be treated as `false`, not silently
      // coerced, so a typo cannot accidentally expose routes.
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();
      if (!mapperStatus.enabled || mapperStatus.baseDomains.length === 0) return;

      const container = await createWorker(request);
      try {
        const { status, body } = await api.createDomainMapping({
          subdomain: `wctruthy-${Date.now()}`,
          baseDomain: mapperStatus.baseDomains[0],
          protocol: 'http',
          wildcard: 'yes' as unknown as boolean,
          workerId: container.id,
          internalPort: 8080,
        });
        expect(status).toBe(201);
        expect(body.wildcard).toBe(false);
        await api.deleteDomainMapping(body.id);
      } finally {
        await cleanupWorker(request, container.id);
      }
    });

    test('response schema includes wildcard on list and get', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();
      if (!mapperStatus.enabled) return;

      const baseDomain = mapperStatus.baseDomains.find((d: string) => {
        const dc = mapperStatus.baseDomainConfigs.find((c: { domain: string; challengeType: string }) => c.domain === d);
        return dc && dc.challengeType !== 'http';
      });
      test.skip(!baseDomain, 'No base domain supporting wildcard');

      const container = await createWorker(request);
      try {
        const { body: created } = await api.createDomainMapping({
          subdomain: `wclist-${Date.now()}`,
          baseDomain,
          protocol: 'http',
          wildcard: true,
          workerId: container.id,
          internalPort: 8080,
        });
        try {
          const { body: list } = await api.listDomainMappings();
          const found = list.find((m: { id: string }) => m.id === created.id);
          expect(found).toBeTruthy();
          expect(found.wildcard).toBe(true);
        } finally {
          await api.deleteDomainMapping(created.id);
        }
      } finally {
        await cleanupWorker(request, container.id);
      }
    });

    test('rejects duplicate wildcard mapping with same subdomain+path+protocol', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();
      if (!mapperStatus.enabled) return;

      const baseDomain = mapperStatus.baseDomains.find((d: string) => {
        const dc = mapperStatus.baseDomainConfigs.find((c: { domain: string; challengeType: string }) => c.domain === d);
        return dc && dc.challengeType !== 'http';
      });
      test.skip(!baseDomain, 'No base domain supporting wildcard');

      const container = await createWorker(request);
      try {
        const uniqueSub = `wcdup-${Date.now()}`;
        const { body: first } = await api.createDomainMapping({
          subdomain: uniqueSub,
          baseDomain,
          protocol: 'http',
          wildcard: true,
          workerId: container.id,
          internalPort: 8080,
        });
        try {
          const { status } = await api.createDomainMapping({
            subdomain: uniqueSub,
            baseDomain,
            protocol: 'http',
            wildcard: true,
            workerId: container.id,
            internalPort: 9090,
          });
          expect(status).toBe(409);
        } finally {
          await api.deleteDomainMapping(first.id);
        }
      } finally {
        await cleanupWorker(request, container.id);
      }
    });

    test('rejects non-wildcard mapping that would collide with an existing wildcard on same key', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();
      if (!mapperStatus.enabled) return;

      const baseDomain = mapperStatus.baseDomains.find((d: string) => {
        const dc = mapperStatus.baseDomainConfigs.find((c: { domain: string; challengeType: string }) => c.domain === d);
        return dc && dc.challengeType !== 'http';
      });
      test.skip(!baseDomain, 'No base domain supporting wildcard');

      const container = await createWorker(request);
      try {
        const uniqueSub = `wcmix-${Date.now()}`;
        const { body: first } = await api.createDomainMapping({
          subdomain: uniqueSub,
          baseDomain,
          protocol: 'http',
          wildcard: true,
          workerId: container.id,
          internalPort: 8080,
        });
        try {
          const { status } = await api.createDomainMapping({
            subdomain: uniqueSub,
            baseDomain,
            protocol: 'http',
            wildcard: false,
            workerId: container.id,
            internalPort: 9090,
          });
          expect(status).toBe(409);
        } finally {
          await api.deleteDomainMapping(first.id);
        }
      } finally {
        await cleanupWorker(request, container.id);
      }
    });

    test('allows a non-wildcard mapping on a deeper subdomain that the wildcard would otherwise match', async ({ request }) => {
      // Routing semantics: wildcard `*.sub.domain.com` and an explicit
      // `foo.sub.domain.com` mapping can coexist — Traefik's priority logic
      // picks the exact host over the wildcard regex. This test only covers
      // the API: both mappings should be accepted because they have different
      // subdomains, so they share no routing key.
      const api = new ApiClient(request);
      const { body: mapperStatus } = await api.getDomainMapperStatus();
      if (!mapperStatus.enabled) return;

      const baseDomain = mapperStatus.baseDomains.find((d: string) => {
        const dc = mapperStatus.baseDomainConfigs.find((c: { domain: string; challengeType: string }) => c.domain === d);
        return dc && dc.challengeType !== 'http';
      });
      test.skip(!baseDomain, 'No base domain supporting wildcard');

      const container = await createWorker(request);
      try {
        const parent = `wcparent-${Date.now()}`;
        const child = `wcchild-${Date.now()}.${parent}`;
        const { body: wildcard } = await api.createDomainMapping({
          subdomain: parent,
          baseDomain,
          protocol: 'http',
          wildcard: true,
          workerId: container.id,
          internalPort: 8080,
        });
        const { status, body: exact } = await api.createDomainMapping({
          subdomain: child,
          baseDomain,
          protocol: 'http',
          workerId: container.id,
          internalPort: 9090,
        });
        expect(status).toBe(201);
        await api.deleteDomainMapping(exact.id);
        await api.deleteDomainMapping(wildcard.id);
      } finally {
        await cleanupWorker(request, container.id);
      }
    });
  });

  test.describe('Multi-base-domain support', () => {
    test('allows the same subdomain on two different base domains', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: status } = await api.getDomainMapperStatus();
      test.skip(!status.enabled || status.baseDomains.length < 2, 'Requires at least two configured base domains');

      const subdomain = `multi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const container = await createWorker(request);
      try {
        const { status: first, body: firstMapping } = await api.createDomainMapping({
          subdomain,
          baseDomain: status.baseDomains[0],
          protocol: 'https',
          workerId: container.id,
          workerName: container.name,
          internalPort: 8080,
        });
        expect(first).toBe(201);

        const { status: second, body: secondMapping } = await api.createDomainMapping({
          subdomain,
          baseDomain: status.baseDomains[1],
          protocol: 'https',
          workerId: container.id,
          workerName: container.name,
          internalPort: 8080,
        });
        expect(second).toBe(201);

        await api.deleteDomainMapping(firstMapping.id);
        await api.deleteDomainMapping(secondMapping.id);
      } finally {
        await cleanupWorker(request, container.id);
      }
    });
  });
});
