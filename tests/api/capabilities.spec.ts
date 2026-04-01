import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { cleanupAllCustomCapabilities } from '../helpers/worker-lifecycle';

const BUILT_IN_CAPABILITY_IDS = ['port-mapping', 'domain-mapping', 'usage', 'tmux'];

test.describe('Capabilities API', () => {
  const createdCapabilityIds: string[] = [];

  test.afterEach(async ({ request }) => {
    const api = new ApiClient(request);
    for (const id of createdCapabilityIds) {
      try { await api.deleteCapability(id); } catch { /* ignore */ }
    }
    createdCapabilityIds.length = 0;
  });

  test.describe('GET /api/capabilities', () => {
    test('returns array with built-in capabilities', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.listCapabilities();
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(BUILT_IN_CAPABILITY_IDS.length);
    });

    test('built-in capabilities have builtIn: true and expected IDs', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.listCapabilities();
      for (const id of BUILT_IN_CAPABILITY_IDS) {
        const capability = body.find((s: { id: string }) => s.id === id);
        expect(capability).toBeTruthy();
        expect(capability.builtIn).toBe(true);
        expect(typeof capability.name).toBe('string');
        expect(capability.name.length).toBeGreaterThan(0);
        expect(typeof capability.content).toBe('string');
        expect(capability.content.length).toBeGreaterThan(0);
      }
    });

    test('list includes newly created custom capability', async ({ request }) => {
      const api = new ApiClient(request);
      const ts = Date.now();
      const { body: created } = await api.createCapability({
        name: `ListCheck-${ts}`,
        content: `# ListCheck content ${ts}`,
      });
      createdCapabilityIds.push(created.id);

      const { body: list } = await api.listCapabilities();
      const found = list.find((s: { id: string }) => s.id === created.id);
      expect(found).toBeTruthy();
      expect(found.name).toBe(`ListCheck-${ts}`);
      expect(found.builtIn).toBe(false);
    });
  });

  test.describe('POST /api/capabilities', () => {
    test('creates custom capability and returns 201 with id, name, content, timestamps', async ({ request }) => {
      const api = new ApiClient(request);
      const ts = Date.now();
      const { status, body } = await api.createCapability({
        name: `Test Capability ${ts}`,
        content: `# Test Capability\nContent for ${ts}`,
      });
      expect(status).toBe(201);
      expect(typeof body.id).toBe('string');
      expect(body.id.length).toBeGreaterThan(0);
      expect(body.name).toBe(`Test Capability ${ts}`);
      expect(body.content).toBe(`# Test Capability\nContent for ${ts}`);
      expect(body.builtIn).toBe(false);
      expect(typeof body.createdAt).toBe('string');
      expect(typeof body.updatedAt).toBe('string');
      createdCapabilityIds.push(body.id);
    });

    test('rejects missing name', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createCapability({ content: '# Some content' });
      expect(status).toBe(400);
    });

    test('rejects missing content', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createCapability({ name: `NoContent-${Date.now()}` });
      expect(status).toBe(400);
    });

    test('rejects empty name string', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createCapability({ name: '', content: '# Content' });
      expect(status).toBe(400);
    });

    test('rejects empty content string', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createCapability({ name: `EmptyContent-${Date.now()}`, content: '' });
      expect(status).toBe(400);
    });

    test('create with all fields - verify returned correctly', async ({ request }) => {
      const api = new ApiClient(request);
      const ts = Date.now();
      const capabilityData = {
        name: `AllFields-${ts}`,
        content: `---\nname: AllFields-${ts}\ndescription: A test capability\n---\n\n# AllFields Capability\n\nDetailed content here.`,
      };
      const { status, body } = await api.createCapability(capabilityData);
      expect(status).toBe(201);
      expect(body.name).toBe(capabilityData.name);
      expect(body.content).toBe(capabilityData.content);
      expect(body.builtIn).toBe(false);
      expect(typeof body.id).toBe('string');
      expect(typeof body.createdAt).toBe('string');
      expect(typeof body.updatedAt).toBe('string');
      createdCapabilityIds.push(body.id);
    });
  });

  test.describe('GET /api/capabilities/:id', () => {
    test('returns a single capability by ID', async ({ request }) => {
      const api = new ApiClient(request);
      const ts = Date.now();
      const { body: created } = await api.createCapability({
        name: `GetTest-${ts}`,
        content: `# GetTest content ${ts}`,
      });
      createdCapabilityIds.push(created.id);

      const { status, body } = await api.getCapability(created.id);
      expect(status).toBe(200);
      expect(body.id).toBe(created.id);
      expect(body.name).toBe(`GetTest-${ts}`);
      expect(body.content).toBe(`# GetTest content ${ts}`);
    });

    test('returns 404 for non-existent capability', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.getCapability('non-existent-capability-id');
      expect(status).toBe(404);
    });

    test('can get built-in capability by ID', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.getCapability('tmux');
      expect(status).toBe(200);
      expect(body.id).toBe('tmux');
      expect(body.builtIn).toBe(true);
    });
  });

  test.describe('PUT /api/capabilities/:id', () => {
    test('updates custom capability changes name and content', async ({ request }) => {
      const api = new ApiClient(request);
      const ts = Date.now();
      const { body: created } = await api.createCapability({
        name: `UpdateTest-${ts}`,
        content: `# Original content ${ts}`,
      });
      createdCapabilityIds.push(created.id);

      const { status, body } = await api.updateCapability(created.id, {
        name: `Updated-${ts}`,
        content: `# Updated content ${ts}`,
      });
      expect(status).toBe(200);
      expect(body.name).toBe(`Updated-${ts}`);
      expect(body.content).toBe(`# Updated content ${ts}`);
    });

    test('update built-in capability returns 400', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.updateCapability('tmux', {
        name: 'Hacked Tmux',
        content: '# Hacked',
      });
      expect(status).toBe(400);
    });

    test('update non-existent capability returns 404', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.updateCapability('non-existent-capability-id', {
        name: 'Ghost',
        content: '# Ghost',
      });
      expect(status).toBe(404);
    });

    test('update rejects empty name', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: created } = await api.createCapability({
        name: `EmptyNameUpdate-${Date.now()}`,
        content: '# Content',
      });
      createdCapabilityIds.push(created.id);

      const { status } = await api.updateCapability(created.id, { name: '' });
      expect(status).toBe(400);
    });

    test('update rejects empty content', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: created } = await api.createCapability({
        name: `EmptyContentUpdate-${Date.now()}`,
        content: '# Content',
      });
      createdCapabilityIds.push(created.id);

      const { status } = await api.updateCapability(created.id, { content: '' });
      expect(status).toBe(400);
    });
  });

  test.describe('DELETE /api/capabilities/:id', () => {
    test('deletes custom capability and returns 200 with { ok: true }', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: created } = await api.createCapability({
        name: `DeleteTest-${Date.now()}`,
        content: '# Delete me',
      });

      const { status, body } = await api.deleteCapability(created.id);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
    });

    test('delete built-in capability returns 400', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.deleteCapability('port-mapping');
      expect(status).toBe(400);
    });

    test('delete non-existent capability returns 404', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.deleteCapability('non-existent-capability-id');
      expect(status).toBe(404);
    });

    test('deleted capability returns 404 on subsequent get', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: created } = await api.createCapability({
        name: `DeleteRefetch-${Date.now()}`,
        content: '# Delete and refetch',
      });
      const capabilityId = created.id;

      const { status: deleteStatus } = await api.deleteCapability(capabilityId);
      expect(deleteStatus).toBe(200);

      const { status: getStatus } = await api.getCapability(capabilityId);
      expect(getStatus).toBe(404);
    });
  });

  test.describe('Partial update behavior', () => {
    test('preserves unchanged fields on partial update', async ({ request }) => {
      const api = new ApiClient(request);
      const ts = Date.now();
      const { body: created } = await api.createCapability({
        name: `Partial-${ts}`,
        content: `# Partial content ${ts}`,
      });
      createdCapabilityIds.push(created.id);

      // Update only the name
      const { body: updated } = await api.updateCapability(created.id, {
        name: `PartialUpdated-${ts}`,
      });
      expect(updated.name).toBe(`PartialUpdated-${ts}`);
      // Content should remain unchanged
      expect(updated.content).toBe(`# Partial content ${ts}`);
    });

    test('update only content preserves name', async ({ request }) => {
      const api = new ApiClient(request);
      const ts = Date.now();
      const { body: created } = await api.createCapability({
        name: `ContentOnly-${ts}`,
        content: `# Original ${ts}`,
      });
      createdCapabilityIds.push(created.id);

      const { body: updated } = await api.updateCapability(created.id, {
        content: `# Updated ${ts}`,
      });
      expect(updated.content).toBe(`# Updated ${ts}`);
      expect(updated.name).toBe(`ContentOnly-${ts}`);
    });

    test('updatedAt changes after update', async ({ request }) => {
      const api = new ApiClient(request);
      const ts = Date.now();
      const { body: created } = await api.createCapability({
        name: `Timestamp-${ts}`,
        content: '# Timestamp test',
      });
      createdCapabilityIds.push(created.id);

      // Small delay to ensure timestamps differ
      await new Promise(r => setTimeout(r, 100));

      const { body: updated } = await api.updateCapability(created.id, {
        name: `TimestampUpdated-${ts}`,
      });
      expect(updated.createdAt).toBe(created.createdAt);
      expect(updated.updatedAt).not.toBe(created.updatedAt);
    });
  });
});
