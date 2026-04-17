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
      for (const key of ['orchestrator', 'worker', 'traefik'] as const) {
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
    test('update status includes all three image keys', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.getUpdateStatus();
      expect('orchestrator' in body).toBe(true);
      expect('worker' in body).toBe(true);
      expect('traefik' in body).toBe(true);
      // Mapper was merged into Traefik — the key must no longer be present.
      expect('mapper' in body).toBe(false);
    });

    test('check returns same structure as status', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.checkForUpdates();
      expect('isProductionMode' in body).toBe(true);
      expect('orchestrator' in body).toBe(true);
      expect('worker' in body).toBe(true);
      expect('traefik' in body).toBe(true);
      expect('mapper' in body).toBe(false);
    });

    test('all three images are non-null with name and localDigest fields', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.getUpdateStatus();
      expect(status).toBe(200);
      for (const key of ['orchestrator', 'worker', 'traefik'] as const) {
        const info = body[key];
        expect(info).not.toBeNull();
        expect(typeof info.name).toBe('string');
        expect(info.name.length).toBeGreaterThan(0);
        expect(typeof info.localDigest).toBe('string');
      }
    });

    test('worker and traefik images have non-empty localDigest', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.getUpdateStatus();
      // These images always exist locally (built or pulled).
      // The orchestrator image may not exist in dev mode (runs from node:22-alpine).
      for (const key of ['worker', 'traefik'] as const) {
        expect(body[key].localDigest.length).toBeGreaterThan(0);
      }
    });

    test('check preserves local-only image entries', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: before } = await api.getUpdateStatus();
      const { body: after } = await api.checkForUpdates();

      // Every image that was non-null before check must remain non-null after
      for (const key of ['orchestrator', 'worker', 'traefik'] as const) {
        if (before[key] !== null) {
          expect(after[key]).not.toBeNull();
          // localDigest should be preserved (not cleared by check)
          expect(after[key].localDigest).toBe(before[key].localDigest);
        }
      }
    });

    test('localDigest is a sha256 hash or image ID', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.getUpdateStatus();
      for (const key of ['orchestrator', 'worker', 'traefik'] as const) {
        const info = body[key];
        if (info?.localDigest) {
          // Either "sha256:<hex>" (registry digest or image ID) or bare hex
          expect(info.localDigest).toMatch(/^(sha256:)?[0-9a-f]+$/);
        }
      }
    });
  });
});
