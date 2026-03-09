import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';

test.describe('Updates API', () => {
  test.describe('GET /api/updates', () => {
    test('returns update status', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.getUpdateStatus();
      expect(status).toBe(200);
      expect(typeof body.isProductionMode).toBe('boolean');
      // Each image field is either null or an ImageUpdateInfo object
      for (const key of ['orchestrator', 'mapper', 'worker', 'traefik'] as const) {
        const val = body[key];
        if (val !== null) {
          expect(typeof val.name).toBe('string');
          expect(typeof val.updateAvailable).toBe('boolean');
          expect(typeof val.lastChecked).toBe('string');
        }
      }
    });
  });

  test.describe('POST /api/updates/check', () => {
    test('triggers a manual update check', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.checkForUpdates();
      expect(status).toBe(200);
      // The check returns the same UpdateStatus shape
      expect(typeof body.isProductionMode).toBe('boolean');
    });
  });

  test.describe('POST /api/updates/apply', () => {
    test('rejects when not in production mode', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: updateStatus } = await api.getUpdateStatus();

      if (!updateStatus.isProductionMode) {
        const { status } = await api.applyUpdates();
        expect(status).toBe(400);
      }
    });

    test('rejects per-image apply when not in production mode', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: updateStatus } = await api.getUpdateStatus();

      if (!updateStatus.isProductionMode) {
        const { status } = await api.applyUpdates(['worker']);
        expect(status).toBe(400);
      }
    });
  });

  test.describe('POST /api/updates/prune', () => {
    // NOTE: Actual prune calls are skipped in dev because they remove
    // the worker image that other tests depend on. We only verify the
    // endpoint exists and returns a valid response shape.
    test('prune endpoint exists and returns valid response', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: updateStatus } = await api.getUpdateStatus();
      // Only call prune when in production mode (GHCR images can be re-pulled).
      // In dev mode, pruning deletes the locally-built agentor-worker image.
      if (updateStatus.isProductionMode) {
        const { status, body } = await api.pruneImages();
        if (status === 200) {
          expect(typeof body.imagesDeleted).toBe('number');
          expect(typeof body.spaceReclaimed).toBe('number');
          expect(body.imagesDeleted).toBeGreaterThanOrEqual(0);
          expect(body.spaceReclaimed).toBeGreaterThanOrEqual(0);
        } else {
          expect(status).toBe(409);
        }
      }
    });
  });

  test.describe('Response structure', () => {
    test('update status includes all four image keys', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.getUpdateStatus();
      expect('orchestrator' in body).toBe(true);
      expect('mapper' in body).toBe(true);
      expect('worker' in body).toBe(true);
      expect('traefik' in body).toBe(true);
    });

    test('check returns same structure as status', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.checkForUpdates();
      expect('isProductionMode' in body).toBe(true);
      expect('orchestrator' in body).toBe(true);
      expect('mapper' in body).toBe(true);
      expect('worker' in body).toBe(true);
      expect('traefik' in body).toBe(true);
    });
  });
});
