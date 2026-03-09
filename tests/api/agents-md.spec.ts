import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { cleanupAllCustomAgentsMd } from '../helpers/worker-lifecycle';

test.describe('AGENTS.md API', () => {
  const createdIds: string[] = [];

  test.afterEach(async ({ request }) => {
    const api = new ApiClient(request);
    for (const id of createdIds) {
      try { await api.deleteAgentsMd(id); } catch { /* ignore */ }
    }
    createdIds.length = 0;
  });

  test.describe('GET /api/agents-md', () => {
    test('returns array with built-in entries', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.listAgentsMd();
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(1);
    });

    test('built-in platform-guide entry has builtIn: true', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.listAgentsMd();
      const platformGuide = body.find((e: { id: string }) => e.id === 'platform-guide');
      expect(platformGuide).toBeTruthy();
      expect(platformGuide.builtIn).toBe(true);
      expect(platformGuide.name).toBeTruthy();
      expect(platformGuide.content).toBeTruthy();
    });

    test('list includes newly created custom entry', async ({ request }) => {
      const api = new ApiClient(request);
      const ts = Date.now();
      const { body: created } = await api.createAgentsMd({
        name: `List-Test-${ts}`,
        content: `# List Test ${ts}\nContent for list test.`,
      });
      createdIds.push(created.id);

      const { body: list } = await api.listAgentsMd();
      const found = list.find((e: { id: string }) => e.id === created.id);
      expect(found).toBeTruthy();
      expect(found.name).toBe(`List-Test-${ts}`);
    });
  });

  test.describe('POST /api/agents-md', () => {
    test('creates custom entry and returns 201', async ({ request }) => {
      const api = new ApiClient(request);
      const ts = Date.now();
      const { status, body } = await api.createAgentsMd({
        name: `Custom Entry ${ts}`,
        content: `# Custom Entry\nThis is test content for ${ts}.`,
      });
      expect(status).toBe(201);
      expect(body.id).toBeTruthy();
      expect(body.name).toBe(`Custom Entry ${ts}`);
      expect(body.content).toContain(`${ts}`);
      expect(body.builtIn).toBe(false);
      createdIds.push(body.id);
    });

    test('rejects missing name', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createAgentsMd({
        content: '# No Name\nContent without a name.',
      });
      expect(status).toBe(400);
    });

    test('rejects missing content', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createAgentsMd({
        name: `No Content ${Date.now()}`,
      });
      expect(status).toBe(400);
    });

    test('rejects empty name string', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createAgentsMd({
        name: '',
        content: '# Empty Name\nContent here.',
      });
      expect(status).toBe(400);
    });

    test('rejects empty content string', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createAgentsMd({
        name: `Empty Content ${Date.now()}`,
        content: '',
      });
      expect(status).toBe(400);
    });

    test('rejects empty body', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createAgentsMd({});
      expect(status).toBe(400);
    });
  });

  test.describe('GET /api/agents-md/:id', () => {
    test('returns a single entry by ID', async ({ request }) => {
      const api = new ApiClient(request);
      const ts = Date.now();
      const { body: created } = await api.createAgentsMd({
        name: `Get Test ${ts}`,
        content: `# Get Test\nContent for ${ts}.`,
      });
      createdIds.push(created.id);

      const { status, body } = await api.getAgentsMd(created.id);
      expect(status).toBe(200);
      expect(body.id).toBe(created.id);
      expect(body.name).toBe(`Get Test ${ts}`);
      expect(body.content).toContain(`${ts}`);
    });

    test('returns built-in entry by ID', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.getAgentsMd('platform-guide');
      expect(status).toBe(200);
      expect(body.id).toBe('platform-guide');
      expect(body.builtIn).toBe(true);
    });

    test('returns 404 for non-existent ID', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.getAgentsMd('non-existent-id');
      expect(status).toBe(404);
    });
  });

  test.describe('PUT /api/agents-md/:id', () => {
    test('updates a custom entry', async ({ request }) => {
      const api = new ApiClient(request);
      const ts = Date.now();
      const { body: created } = await api.createAgentsMd({
        name: `Update Test ${ts}`,
        content: `# Original\nOriginal content.`,
      });
      createdIds.push(created.id);

      const { status, body } = await api.updateAgentsMd(created.id, {
        name: `Updated Name ${ts}`,
        content: `# Updated\nUpdated content for ${ts}.`,
      });
      expect(status).toBe(200);
      expect(body.name).toBe(`Updated Name ${ts}`);
      expect(body.content).toContain('Updated content');
    });

    test('returns 400 when updating built-in entry', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.updateAgentsMd('platform-guide', {
        name: 'Modified Built-in',
      });
      expect(status).toBe(400);
    });

    test('returns 404 for non-existent ID', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.updateAgentsMd('non-existent-id', {
        name: 'Does Not Exist',
      });
      expect(status).toBe(404);
    });

    test('rejects empty name on update', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: created } = await api.createAgentsMd({
        name: `Empty Name Update ${Date.now()}`,
        content: '# Test\nContent.',
      });
      createdIds.push(created.id);

      const { status } = await api.updateAgentsMd(created.id, { name: '' });
      expect(status).toBe(400);
    });
  });

  test.describe('DELETE /api/agents-md/:id', () => {
    test('deletes a custom entry and returns { ok: true }', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: created } = await api.createAgentsMd({
        name: `Delete Test ${Date.now()}`,
        content: '# Delete Me\nThis will be deleted.',
      });

      const { status, body } = await api.deleteAgentsMd(created.id);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
    });

    test('returns 400 when deleting built-in entry', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.deleteAgentsMd('platform-guide');
      expect(status).toBe(400);
    });

    test('returns 404 for non-existent ID', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.deleteAgentsMd('non-existent-id');
      expect(status).toBe(404);
    });

    test('deleted entry returns 404 on get', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: created } = await api.createAgentsMd({
        name: `Delete Refetch ${Date.now()}`,
        content: '# Refetch Test\nContent.',
      });
      const entryId = created.id;

      const { status: deleteStatus } = await api.deleteAgentsMd(entryId);
      expect(deleteStatus).toBe(200);

      const { status: getStatus } = await api.getAgentsMd(entryId);
      expect(getStatus).toBe(404);
    });
  });

  test.describe('Field behavior', () => {
    test('entry has all expected fields (id, name, content, builtIn, timestamps)', async ({ request }) => {
      const api = new ApiClient(request);
      const ts = Date.now();
      const { body } = await api.createAgentsMd({
        name: `Fields Test ${ts}`,
        content: `# Fields\nContent for ${ts}.`,
      });
      createdIds.push(body.id);

      expect(typeof body.id).toBe('string');
      expect(body.id.length).toBeGreaterThan(0);
      expect(typeof body.name).toBe('string');
      expect(typeof body.content).toBe('string');
      expect(body.builtIn).toBe(false);
      expect(typeof body.createdAt).toBe('string');
      expect(typeof body.updatedAt).toBe('string');
    });

    test('custom entry has builtIn: false', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.createAgentsMd({
        name: `BuiltIn Flag ${Date.now()}`,
        content: '# Flag Test\nContent.',
      });
      createdIds.push(body.id);
      expect(body.builtIn).toBe(false);
    });
  });

  test.describe('Partial update behavior', () => {
    test('preserves unchanged fields on partial update', async ({ request }) => {
      const api = new ApiClient(request);
      const ts = Date.now();
      const originalContent = `# Partial\nOriginal content for ${ts}.`;
      const { body: created } = await api.createAgentsMd({
        name: `Partial Test ${ts}`,
        content: originalContent,
      });
      createdIds.push(created.id);

      // Update only the name
      const { body: updated } = await api.updateAgentsMd(created.id, {
        name: `Partial Updated ${ts}`,
      });
      expect(updated.name).toBe(`Partial Updated ${ts}`);
      // Content should remain unchanged
      expect(updated.content).toBe(originalContent);
    });

    test('updates only content when name is omitted', async ({ request }) => {
      const api = new ApiClient(request);
      const ts = Date.now();
      const originalName = `Content Only ${ts}`;
      const { body: created } = await api.createAgentsMd({
        name: originalName,
        content: '# Original\nOriginal content.',
      });
      createdIds.push(created.id);

      const newContent = `# Updated\nUpdated content for ${ts}.`;
      const { body: updated } = await api.updateAgentsMd(created.id, {
        content: newContent,
      });
      expect(updated.content).toBe(newContent);
      // Name should remain unchanged
      expect(updated.name).toBe(originalName);
    });

    test('updatedAt changes after update', async ({ request }) => {
      const api = new ApiClient(request);
      const ts = Date.now();
      const { body: created } = await api.createAgentsMd({
        name: `Timestamp Test ${ts}`,
        content: '# Timestamp\nContent.',
      });
      createdIds.push(created.id);

      // Small delay to ensure timestamps differ
      await new Promise(r => setTimeout(r, 100));

      const { body: updated } = await api.updateAgentsMd(created.id, {
        name: `Timestamp Updated ${ts}`,
      });
      expect(updated.createdAt).toBe(created.createdAt);
      expect(updated.updatedAt).not.toBe(created.updatedAt);
    });
  });

  test.describe('List completeness', () => {
    test('list entries include all fields', async ({ request }) => {
      const api = new ApiClient(request);
      const ts = Date.now();
      const { body: created } = await api.createAgentsMd({
        name: `ListFields Test ${ts}`,
        content: `# ListFields\nContent for ${ts}.`,
      });
      createdIds.push(created.id);

      const { body: list } = await api.listAgentsMd();
      const found = list.find((e: { id: string }) => e.id === created.id);
      expect(found).toBeTruthy();
      expect(found.name).toBe(`ListFields Test ${ts}`);
      expect(found.content).toContain(`${ts}`);
      expect(found.builtIn).toBe(false);
      expect(typeof found.createdAt).toBe('string');
      expect(typeof found.updatedAt).toBe('string');
    });
  });

  test.describe('Update with same values', () => {
    test('update with same name succeeds', async ({ request }) => {
      const api = new ApiClient(request);
      const ts = Date.now();
      const entryName = `SameName-${ts}`;
      const { body: created } = await api.createAgentsMd({
        name: entryName,
        content: '# Same Name\nContent.',
      });
      createdIds.push(created.id);

      const { status, body } = await api.updateAgentsMd(created.id, { name: entryName });
      expect(status).toBe(200);
      expect(body.name).toBe(entryName);
    });
  });
});
