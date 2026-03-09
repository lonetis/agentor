import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { cleanupAllCustomSkills } from '../helpers/worker-lifecycle';

const BUILT_IN_SKILL_IDS = ['port-mapping', 'domain-mapping', 'usage', 'tmux'];

test.describe('Skills API', () => {
  const createdSkillIds: string[] = [];

  test.afterEach(async ({ request }) => {
    const api = new ApiClient(request);
    for (const id of createdSkillIds) {
      try { await api.deleteSkill(id); } catch { /* ignore */ }
    }
    createdSkillIds.length = 0;
  });

  test.describe('GET /api/skills', () => {
    test('returns array with built-in skills', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.listSkills();
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(BUILT_IN_SKILL_IDS.length);
    });

    test('built-in skills have builtIn: true and expected IDs', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.listSkills();
      for (const id of BUILT_IN_SKILL_IDS) {
        const skill = body.find((s: { id: string }) => s.id === id);
        expect(skill).toBeTruthy();
        expect(skill.builtIn).toBe(true);
        expect(typeof skill.name).toBe('string');
        expect(skill.name.length).toBeGreaterThan(0);
        expect(typeof skill.content).toBe('string');
        expect(skill.content.length).toBeGreaterThan(0);
      }
    });

    test('list includes newly created custom skill', async ({ request }) => {
      const api = new ApiClient(request);
      const ts = Date.now();
      const { body: created } = await api.createSkill({
        name: `ListCheck-${ts}`,
        content: `# ListCheck content ${ts}`,
      });
      createdSkillIds.push(created.id);

      const { body: list } = await api.listSkills();
      const found = list.find((s: { id: string }) => s.id === created.id);
      expect(found).toBeTruthy();
      expect(found.name).toBe(`ListCheck-${ts}`);
      expect(found.builtIn).toBe(false);
    });
  });

  test.describe('POST /api/skills', () => {
    test('creates custom skill and returns 201 with id, name, content, timestamps', async ({ request }) => {
      const api = new ApiClient(request);
      const ts = Date.now();
      const { status, body } = await api.createSkill({
        name: `Test Skill ${ts}`,
        content: `# Test Skill\nContent for ${ts}`,
      });
      expect(status).toBe(201);
      expect(typeof body.id).toBe('string');
      expect(body.id.length).toBeGreaterThan(0);
      expect(body.name).toBe(`Test Skill ${ts}`);
      expect(body.content).toBe(`# Test Skill\nContent for ${ts}`);
      expect(body.builtIn).toBe(false);
      expect(typeof body.createdAt).toBe('string');
      expect(typeof body.updatedAt).toBe('string');
      createdSkillIds.push(body.id);
    });

    test('rejects missing name', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createSkill({ content: '# Some content' });
      expect(status).toBe(400);
    });

    test('rejects missing content', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createSkill({ name: `NoContent-${Date.now()}` });
      expect(status).toBe(400);
    });

    test('rejects empty name string', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createSkill({ name: '', content: '# Content' });
      expect(status).toBe(400);
    });

    test('rejects empty content string', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createSkill({ name: `EmptyContent-${Date.now()}`, content: '' });
      expect(status).toBe(400);
    });

    test('create with all fields - verify returned correctly', async ({ request }) => {
      const api = new ApiClient(request);
      const ts = Date.now();
      const skillData = {
        name: `AllFields-${ts}`,
        content: `---\nname: AllFields-${ts}\ndescription: A test skill\n---\n\n# AllFields Skill\n\nDetailed content here.`,
      };
      const { status, body } = await api.createSkill(skillData);
      expect(status).toBe(201);
      expect(body.name).toBe(skillData.name);
      expect(body.content).toBe(skillData.content);
      expect(body.builtIn).toBe(false);
      expect(typeof body.id).toBe('string');
      expect(typeof body.createdAt).toBe('string');
      expect(typeof body.updatedAt).toBe('string');
      createdSkillIds.push(body.id);
    });
  });

  test.describe('GET /api/skills/:id', () => {
    test('returns a single skill by ID', async ({ request }) => {
      const api = new ApiClient(request);
      const ts = Date.now();
      const { body: created } = await api.createSkill({
        name: `GetTest-${ts}`,
        content: `# GetTest content ${ts}`,
      });
      createdSkillIds.push(created.id);

      const { status, body } = await api.getSkill(created.id);
      expect(status).toBe(200);
      expect(body.id).toBe(created.id);
      expect(body.name).toBe(`GetTest-${ts}`);
      expect(body.content).toBe(`# GetTest content ${ts}`);
    });

    test('returns 404 for non-existent skill', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.getSkill('non-existent-skill-id');
      expect(status).toBe(404);
    });

    test('can get built-in skill by ID', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.getSkill('tmux');
      expect(status).toBe(200);
      expect(body.id).toBe('tmux');
      expect(body.builtIn).toBe(true);
    });
  });

  test.describe('PUT /api/skills/:id', () => {
    test('updates custom skill changes name and content', async ({ request }) => {
      const api = new ApiClient(request);
      const ts = Date.now();
      const { body: created } = await api.createSkill({
        name: `UpdateTest-${ts}`,
        content: `# Original content ${ts}`,
      });
      createdSkillIds.push(created.id);

      const { status, body } = await api.updateSkill(created.id, {
        name: `Updated-${ts}`,
        content: `# Updated content ${ts}`,
      });
      expect(status).toBe(200);
      expect(body.name).toBe(`Updated-${ts}`);
      expect(body.content).toBe(`# Updated content ${ts}`);
    });

    test('update built-in skill returns 400', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.updateSkill('tmux', {
        name: 'Hacked Tmux',
        content: '# Hacked',
      });
      expect(status).toBe(400);
    });

    test('update non-existent skill returns 404', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.updateSkill('non-existent-skill-id', {
        name: 'Ghost',
        content: '# Ghost',
      });
      expect(status).toBe(404);
    });

    test('update rejects empty name', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: created } = await api.createSkill({
        name: `EmptyNameUpdate-${Date.now()}`,
        content: '# Content',
      });
      createdSkillIds.push(created.id);

      const { status } = await api.updateSkill(created.id, { name: '' });
      expect(status).toBe(400);
    });

    test('update rejects empty content', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: created } = await api.createSkill({
        name: `EmptyContentUpdate-${Date.now()}`,
        content: '# Content',
      });
      createdSkillIds.push(created.id);

      const { status } = await api.updateSkill(created.id, { content: '' });
      expect(status).toBe(400);
    });
  });

  test.describe('DELETE /api/skills/:id', () => {
    test('deletes custom skill and returns 200 with { ok: true }', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: created } = await api.createSkill({
        name: `DeleteTest-${Date.now()}`,
        content: '# Delete me',
      });

      const { status, body } = await api.deleteSkill(created.id);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
    });

    test('delete built-in skill returns 400', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.deleteSkill('port-mapping');
      expect(status).toBe(400);
    });

    test('delete non-existent skill returns 404', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.deleteSkill('non-existent-skill-id');
      expect(status).toBe(404);
    });

    test('deleted skill returns 404 on subsequent get', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: created } = await api.createSkill({
        name: `DeleteRefetch-${Date.now()}`,
        content: '# Delete and refetch',
      });
      const skillId = created.id;

      const { status: deleteStatus } = await api.deleteSkill(skillId);
      expect(deleteStatus).toBe(200);

      const { status: getStatus } = await api.getSkill(skillId);
      expect(getStatus).toBe(404);
    });
  });

  test.describe('Partial update behavior', () => {
    test('preserves unchanged fields on partial update', async ({ request }) => {
      const api = new ApiClient(request);
      const ts = Date.now();
      const { body: created } = await api.createSkill({
        name: `Partial-${ts}`,
        content: `# Partial content ${ts}`,
      });
      createdSkillIds.push(created.id);

      // Update only the name
      const { body: updated } = await api.updateSkill(created.id, {
        name: `PartialUpdated-${ts}`,
      });
      expect(updated.name).toBe(`PartialUpdated-${ts}`);
      // Content should remain unchanged
      expect(updated.content).toBe(`# Partial content ${ts}`);
    });

    test('update only content preserves name', async ({ request }) => {
      const api = new ApiClient(request);
      const ts = Date.now();
      const { body: created } = await api.createSkill({
        name: `ContentOnly-${ts}`,
        content: `# Original ${ts}`,
      });
      createdSkillIds.push(created.id);

      const { body: updated } = await api.updateSkill(created.id, {
        content: `# Updated ${ts}`,
      });
      expect(updated.content).toBe(`# Updated ${ts}`);
      expect(updated.name).toBe(`ContentOnly-${ts}`);
    });

    test('updatedAt changes after update', async ({ request }) => {
      const api = new ApiClient(request);
      const ts = Date.now();
      const { body: created } = await api.createSkill({
        name: `Timestamp-${ts}`,
        content: '# Timestamp test',
      });
      createdSkillIds.push(created.id);

      // Small delay to ensure timestamps differ
      await new Promise(r => setTimeout(r, 100));

      const { body: updated } = await api.updateSkill(created.id, {
        name: `TimestampUpdated-${ts}`,
      });
      expect(updated.createdAt).toBe(created.createdAt);
      expect(updated.updatedAt).not.toBe(created.updatedAt);
    });
  });
});
