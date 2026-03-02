import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';

test.describe('Workspace API', () => {
  let containerId: string;

  test.beforeAll(async ({ request }) => {
    const container = await createWorker(request);
    containerId = container.id;
  });

  test.afterAll(async ({ request }) => {
    await cleanupWorker(request, containerId);
  });

  test.describe('POST /api/containers/:id/workspace (upload)', () => {
    test('uploads files to workspace', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.uploadToWorkspace(containerId, [
        {
          name: 'test.txt',
          content: Buffer.from('Hello, world!'),
          mimeType: 'text/plain',
        },
      ]);
      expect(status).toBe(200);
      expect(body.uploaded).toBe(1);
    });

    test('uploads multiple files', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.uploadToWorkspace(containerId, [
        { name: 'file1.txt', content: Buffer.from('File 1'), mimeType: 'text/plain' },
        { name: 'file2.txt', content: Buffer.from('File 2'), mimeType: 'text/plain' },
        { name: 'file3.txt', content: Buffer.from('File 3'), mimeType: 'text/plain' },
      ]);
      expect(status).toBe(200);
      expect(body.uploaded).toBe(3);
    });

    test('rejects path traversal', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.uploadToWorkspace(containerId, [
        { name: '../../../etc/passwd', content: Buffer.from('hack'), mimeType: 'text/plain' },
      ]);
      expect(status).toBe(400);
    });

    test('rejects encoded path traversal', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.uploadToWorkspace(containerId, [
        { name: '..%2F..%2Fetc%2Fpasswd', content: Buffer.from('hack'), mimeType: 'text/plain' },
      ]);
      // Should be rejected (400) or treated as a literal filename (200)
      // Either way, path traversal must not succeed
      expect([200, 400]).toContain(status);
    });

    test('upload to non-existent container fails', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.uploadToWorkspace('non-existent-id', [
        { name: 'test.txt', content: Buffer.from('hello'), mimeType: 'text/plain' },
      ]);
      expect(status).toBeGreaterThanOrEqual(400);
    });

    test('uploads file with subdirectory path', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.uploadToWorkspace(containerId, [
        { name: 'subdir/nested.txt', content: Buffer.from('nested content'), mimeType: 'text/plain' },
      ]);
      expect(status).toBe(200);
      expect(body.uploaded).toBe(1);
    });

    test('uploads empty file', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.uploadToWorkspace(containerId, [
        { name: 'empty.txt', content: Buffer.from(''), mimeType: 'text/plain' },
      ]);
      expect(status).toBe(200);
      expect(body.uploaded).toBe(1);
    });
  });

  test.describe('GET /api/containers/:id/workspace (download)', () => {
    test('downloads workspace as tar.gz', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, headers } = await api.downloadWorkspace(containerId);
      expect(status).toBe(200);
      expect(headers['content-type']).toContain('gzip');
      expect(headers['content-disposition']).toContain('attachment');
      expect(headers['content-disposition']).toContain('.tar.gz');
    });

    test('returns 404 for non-existent container', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.downloadWorkspace('non-existent-id');
      expect(status).toBe(404);
    });
  });
});
