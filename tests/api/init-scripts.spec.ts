import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';

test.describe('Init Scripts API', () => {
  const createdIds: string[] = [];

  test.afterEach(async ({ request }) => {
    const api = new ApiClient(request);
    for (const id of createdIds) {
      try { await api.deleteInitScript(id); } catch { /* ignore */ }
    }
    createdIds.length = 0;
  });

  test.describe('GET /api/init-scripts', () => {
    test('returns array with built-in scripts', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.listInitScripts();
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(3);
    });

    test('built-in scripts have builtIn: true and expected IDs', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.listInitScripts();
      const builtInIds = body
        .filter((s: { builtIn: boolean }) => s.builtIn)
        .map((s: { id: string }) => s.id);
      expect(builtInIds).toContain('claude');
      expect(builtInIds).toContain('codex');
      expect(builtInIds).toContain('gemini');
    });

    test('built-in scripts have non-empty content', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.listInitScripts();
      const builtIns = body.filter((s: { builtIn: boolean }) => s.builtIn);
      for (const script of builtIns) {
        expect(typeof script.content).toBe('string');
        expect(script.content.length).toBeGreaterThan(0);
      }
    });

    test('list includes newly created custom script', async ({ request }) => {
      const api = new ApiClient(request);
      const name = `List-Test-${Date.now()}`;
      const { body: created } = await api.createInitScript({
        name,
        content: '#!/bin/bash\necho list-test',
      });
      createdIds.push(created.id);

      const { body: list } = await api.listInitScripts();
      const found = list.find((s: { id: string }) => s.id === created.id);
      expect(found).toBeTruthy();
      expect(found.name).toBe(name);
      expect(found.builtIn).toBe(false);
    });
  });

  test.describe('POST /api/init-scripts', () => {
    test('creates custom script and returns 201', async ({ request }) => {
      const api = new ApiClient(request);
      const name = `Custom-${Date.now()}`;
      const content = '#!/bin/bash\necho hello';
      const { status, body } = await api.createInitScript({ name, content });
      expect(status).toBe(201);
      expect(body.id).toBeTruthy();
      expect(body.name).toBe(name);
      expect(body.content).toBe(content);
      expect(body.builtIn).toBe(false);
      expect(typeof body.createdAt).toBe('string');
      expect(typeof body.updatedAt).toBe('string');
      createdIds.push(body.id);
    });

    test('rejects missing name', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createInitScript({
        content: '#!/bin/bash\necho no-name',
      });
      expect(status).toBe(400);
    });

    test('rejects missing content', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createInitScript({
        name: `NoContent-${Date.now()}`,
      });
      expect(status).toBe(400);
    });

    test('rejects empty name string', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createInitScript({
        name: '',
        content: '#!/bin/bash\necho empty-name',
      });
      expect(status).toBe(400);
    });

    test('rejects empty content string', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createInitScript({
        name: `EmptyContent-${Date.now()}`,
        content: '',
      });
      expect(status).toBe(400);
    });
  });

  test.describe('GET /api/init-scripts/:id', () => {
    test('returns a single script by ID', async ({ request }) => {
      const api = new ApiClient(request);
      const name = `Get-${Date.now()}`;
      const { body: created } = await api.createInitScript({
        name,
        content: '#!/bin/bash\necho get-test',
      });
      createdIds.push(created.id);

      const { status, body } = await api.getInitScript(created.id);
      expect(status).toBe(200);
      expect(body.id).toBe(created.id);
      expect(body.name).toBe(name);
      expect(body.content).toBe('#!/bin/bash\necho get-test');
    });

    test('returns built-in script by ID', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.getInitScript('claude');
      expect(status).toBe(200);
      expect(body.id).toBe('claude');
      expect(body.builtIn).toBe(true);
      expect(body.content.length).toBeGreaterThan(0);
    });

    test('returns 404 for non-existent ID', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.getInitScript('non-existent-id');
      expect(status).toBe(404);
    });
  });

  test.describe('PUT /api/init-scripts/:id', () => {
    test('updates a custom script', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: created } = await api.createInitScript({
        name: `Update-${Date.now()}`,
        content: '#!/bin/bash\necho original',
      });
      createdIds.push(created.id);

      const { status, body } = await api.updateInitScript(created.id, {
        name: 'Updated Name',
        content: '#!/bin/bash\necho updated',
      });
      expect(status).toBe(200);
      expect(body.name).toBe('Updated Name');
      expect(body.content).toBe('#!/bin/bash\necho updated');
    });

    test('returns 400 when updating built-in script', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.updateInitScript('claude', {
        name: 'Hacked Claude',
        content: '#!/bin/bash\necho hacked',
      });
      expect(status).toBe(400);
    });

    test('returns 404 for non-existent ID', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.updateInitScript('non-existent-id', {
        name: 'Ghost',
        content: '#!/bin/bash\necho ghost',
      });
      expect(status).toBe(404);
    });

    test('rejects empty name on update', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: created } = await api.createInitScript({
        name: `EmptyNameUpdate-${Date.now()}`,
        content: '#!/bin/bash\necho test',
      });
      createdIds.push(created.id);

      const { status } = await api.updateInitScript(created.id, { name: '' });
      expect(status).toBe(400);
    });

    test('update with only content field preserves name', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: created } = await api.createInitScript({
        name: `ContentOnly-${Date.now()}`,
        content: '#!/bin/bash\necho test',
      });
      createdIds.push(created.id);

      const { status, body } = await api.updateInitScript(created.id, { content: '#!/bin/bash\necho updated' });
      expect(status).toBe(200);
      expect(body.name).toBe(created.name);
      expect(body.content).toBe('#!/bin/bash\necho updated');
    });
  });

  test.describe('DELETE /api/init-scripts/:id', () => {
    test('deletes a custom script and returns { ok: true }', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: created } = await api.createInitScript({
        name: `Delete-${Date.now()}`,
        content: '#!/bin/bash\necho delete-me',
      });

      const { status, body } = await api.deleteInitScript(created.id);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
    });

    test('returns 400 when deleting built-in script', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.deleteInitScript('claude');
      expect(status).toBe(400);
    });

    test('returns 404 for non-existent ID', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.deleteInitScript('non-existent-id');
      expect(status).toBe(404);
    });

    test('deleted script returns 404 on get', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: created } = await api.createInitScript({
        name: `DeleteRefetch-${Date.now()}`,
        content: '#!/bin/bash\necho refetch',
      });
      const scriptId = created.id;

      const { status: deleteStatus } = await api.deleteInitScript(scriptId);
      expect(deleteStatus).toBe(200);

      const { status: getStatus } = await api.getInitScript(scriptId);
      expect(getStatus).toBe(404);
    });
  });

  test.describe('Partial update behavior', () => {
    test('preserves unchanged fields on partial update', async ({ request }) => {
      const api = new ApiClient(request);
      const originalName = `Partial-${Date.now()}`;
      const originalContent = '#!/bin/bash\necho partial';
      const { body: created } = await api.createInitScript({
        name: originalName,
        content: originalContent,
      });
      createdIds.push(created.id);

      // Update only the name
      const { body: updated } = await api.updateInitScript(created.id, {
        name: 'Partial Updated',
      });
      expect(updated.name).toBe('Partial Updated');
      expect(updated.content).toBe(originalContent);
    });

    test('updatedAt changes after update', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: created } = await api.createInitScript({
        name: `Timestamp-${Date.now()}`,
        content: '#!/bin/bash\necho timestamp',
      });
      createdIds.push(created.id);

      // Small delay to ensure timestamps differ
      await new Promise(r => setTimeout(r, 100));

      const { body: updated } = await api.updateInitScript(created.id, {
        name: 'Timestamp Updated',
      });
      expect(updated.createdAt).toBe(created.createdAt);
      expect(updated.updatedAt).not.toBe(created.updatedAt);
    });
  });

  test.describe('Field behavior', () => {
    test('created script has id and timestamps', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.createInitScript({
        name: `Fields-${Date.now()}`,
        content: '#!/bin/bash\necho fields',
      });
      createdIds.push(body.id);
      expect(typeof body.id).toBe('string');
      expect(body.id.length).toBeGreaterThan(0);
      expect(typeof body.createdAt).toBe('string');
      expect(typeof body.updatedAt).toBe('string');
    });

    test('custom script has builtIn: false', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.createInitScript({
        name: `BuiltInFlag-${Date.now()}`,
        content: '#!/bin/bash\necho flag',
      });
      createdIds.push(body.id);
      expect(body.builtIn).toBe(false);
    });
  });
});
