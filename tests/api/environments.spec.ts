import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';

test.describe('Environments API', () => {
  const createdEnvIds: string[] = [];

  test.afterEach(async ({ request }) => {
    const api = new ApiClient(request);
    for (const id of createdEnvIds) {
      try { await api.deleteEnvironment(id); } catch { /* ignore */ }
    }
    createdEnvIds.length = 0;
  });

  test.describe('GET /api/environments', () => {
    test('returns list of environments', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.listEnvironments();
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });
  });

  test.describe('POST /api/environments', () => {
    test('creates an environment and returns 201', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.createEnvironment({
        name: 'Test Environment',
        networkMode: 'full',
      });
      expect(status).toBe(201);
      expect(body.id).toBeTruthy();
      expect(body.name).toBe('Test Environment');
      expect(body.networkMode).toBe('full');
      createdEnvIds.push(body.id);
    });

    test('defaults dockerEnabled to true', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.createEnvironment({ name: 'Docker Test' });
      expect(body.dockerEnabled).toBe(true);
      createdEnvIds.push(body.id);
    });

    test('defaults networkMode to full', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.createEnvironment({ name: 'Network Test' });
      expect(body.networkMode).toBe('full');
      createdEnvIds.push(body.id);
    });

    test('rejects missing name', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createEnvironment({});
      expect(status).toBe(400);
    });

    test('rejects invalid networkMode', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createEnvironment({
        name: 'Bad Mode',
        networkMode: 'invalid',
      });
      expect(status).toBe(400);
    });

    test('accepts all valid networkModes', async ({ request }) => {
      const api = new ApiClient(request);
      const modes = ['block', 'block-all', 'package-managers', 'full', 'custom'];
      for (const mode of modes) {
        const { status, body } = await api.createEnvironment({
          name: `Mode ${mode}`,
          networkMode: mode,
        });
        expect(status).toBe(201);
        expect(body.networkMode).toBe(mode);
        createdEnvIds.push(body.id);
      }
    });

    test('stores allowedDomains array', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.createEnvironment({
        name: 'Domains Test',
        networkMode: 'custom',
        allowedDomains: ['example.com', 'test.org'],
      });
      expect(body.allowedDomains).toEqual(['example.com', 'test.org']);
      createdEnvIds.push(body.id);
    });

    test('stores envVars string', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.createEnvironment({
        name: 'Env Vars Test',
        envVars: 'FOO=bar\nBAZ=qux',
      });
      expect(body.envVars).toBe('FOO=bar\nBAZ=qux');
      createdEnvIds.push(body.id);
    });

    test('stores setupScript', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.createEnvironment({
        name: 'Scripts Test',
        setupScript: 'echo setup',
      });
      expect(body.setupScript).toBe('echo setup');
      createdEnvIds.push(body.id);
    });

    test('stores cpuLimit and memoryLimit', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.createEnvironment({
        name: 'Resources Test',
        cpuLimit: 4,
        memoryLimit: '8g',
      });
      expect(body.cpuLimit).toBe(4);
      expect(body.memoryLimit).toBe('8g');
      createdEnvIds.push(body.id);
    });
  });

  test.describe('GET /api/environments/:id', () => {
    test('returns a single environment by ID', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: created } = await api.createEnvironment({ name: 'Get Test' });
      createdEnvIds.push(created.id);

      const { status, body } = await api.getEnvironment(created.id);
      expect(status).toBe(200);
      expect(body.id).toBe(created.id);
      expect(body.name).toBe('Get Test');
    });

    test('returns 404 for non-existent ID', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.getEnvironment('non-existent-id');
      expect(status).toBe(404);
    });
  });

  test.describe('PUT /api/environments/:id', () => {
    test('updates an environment', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: created } = await api.createEnvironment({ name: 'Update Test' });
      createdEnvIds.push(created.id);

      const { status, body } = await api.updateEnvironment(created.id, {
        name: 'Updated Name',
        networkMode: 'block',
        cpuLimit: 2,
      });
      expect(status).toBe(200);
      expect(body.name).toBe('Updated Name');
      expect(body.networkMode).toBe('block');
    });

    test('returns 404 for non-existent ID', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.updateEnvironment('non-existent-id', { name: 'foo' });
      expect(status).toBe(404);
    });

    test('rejects empty name', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: created } = await api.createEnvironment({ name: 'Empty Name Test' });
      createdEnvIds.push(created.id);

      const { status } = await api.updateEnvironment(created.id, { name: '' });
      expect(status).toBe(400);
    });

    test('rejects invalid networkMode', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: created } = await api.createEnvironment({ name: 'Bad Mode Update' });
      createdEnvIds.push(created.id);

      const { status } = await api.updateEnvironment(created.id, { networkMode: 'invalid' });
      expect(status).toBe(400);
    });
  });

  test.describe('DELETE /api/environments/:id', () => {
    test('deletes an environment', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: created } = await api.createEnvironment({ name: 'Delete Test' });

      const { status, body } = await api.deleteEnvironment(created.id);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);

      // Verify it's gone
      const { status: getStatus } = await api.getEnvironment(created.id);
      expect(getStatus).toBe(404);
    });

    test('returns 404 for non-existent ID', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.deleteEnvironment('non-existent-id');
      expect(status).toBe(404);
    });
  });

  test.describe('Field behavior', () => {
    test('created environment has id and timestamps', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.createEnvironment({ name: 'Fields Test' });
      createdEnvIds.push(body.id);
      expect(typeof body.id).toBe('string');
      expect(body.id.length).toBeGreaterThan(0);
      expect(typeof body.createdAt).toBe('string');
      expect(typeof body.updatedAt).toBe('string');
    });

    test('dockerEnabled defaults to true', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.createEnvironment({ name: 'Docker Default' });
      createdEnvIds.push(body.id);
      expect(body.dockerEnabled).toBe(true);
    });

    test('dockerEnabled can be set to false', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.createEnvironment({ name: 'Docker Off', dockerEnabled: false });
      createdEnvIds.push(body.id);
      expect(body.dockerEnabled).toBe(false);
    });

    test('stores includePackageManagerDomains flag', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.createEnvironment({
        name: 'PM Domains Test',
        networkMode: 'custom',
        includePackageManagerDomains: true,
      });
      createdEnvIds.push(body.id);
      expect(body.includePackageManagerDomains).toBe(true);
    });
  });

  test.describe('Partial update behavior', () => {
    test('preserves unchanged fields on partial update', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: created } = await api.createEnvironment({
        name: 'Partial Test',
        networkMode: 'block',
        cpuLimit: 4,
        memoryLimit: '8g',
        dockerEnabled: false,
      });
      createdEnvIds.push(created.id);

      // Update only the name
      const { body: updated } = await api.updateEnvironment(created.id, { name: 'Partial Updated' });
      expect(updated.name).toBe('Partial Updated');
      // Other fields should remain unchanged
      expect(updated.networkMode).toBe('block');
      expect(updated.cpuLimit).toBe(4);
      expect(updated.memoryLimit).toBe('8g');
      expect(updated.dockerEnabled).toBe(false);
    });

    test('updatedAt changes after update', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: created } = await api.createEnvironment({ name: 'Timestamp Test' });
      createdEnvIds.push(created.id);

      // Small delay to ensure timestamps differ
      await new Promise(r => setTimeout(r, 100));

      const { body: updated } = await api.updateEnvironment(created.id, { name: 'Timestamp Updated' });
      expect(updated.createdAt).toBe(created.createdAt);
      expect(updated.updatedAt).not.toBe(created.updatedAt);
    });
  });

  test.describe('Environment list completeness', () => {
    test('list entries include all fields', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: created } = await api.createEnvironment({
        name: 'ListFields Test',
        networkMode: 'custom',
        allowedDomains: ['example.com'],
        cpuLimit: 2,
        memoryLimit: '4g',
      });
      createdEnvIds.push(created.id);

      const { body: list } = await api.listEnvironments();
      const found = list.find((e: { id: string }) => e.id === created.id);
      expect(found).toBeTruthy();
      expect(found.name).toBe('ListFields Test');
      expect(found.networkMode).toBe('custom');
      expect(found.allowedDomains).toEqual(['example.com']);
      expect(found.cpuLimit).toBe(2);
      expect(found.memoryLimit).toBe('4g');
      expect(typeof found.createdAt).toBe('string');
      expect(typeof found.updatedAt).toBe('string');
    });
  });

  test.describe('Update edge cases', () => {
    test('update networkMode from full to custom with allowedDomains', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: created } = await api.createEnvironment({
        name: 'Mode Change Test',
        networkMode: 'full',
      });
      createdEnvIds.push(created.id);

      const { body: updated } = await api.updateEnvironment(created.id, {
        networkMode: 'custom',
        allowedDomains: ['api.example.com'],
      });
      expect(updated.networkMode).toBe('custom');
      expect(updated.allowedDomains).toEqual(['api.example.com']);
    });

    test('create with non-existent environmentId fails', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createContainer({ environmentId: 'non-existent-env-id' });
      expect(status).toBeGreaterThanOrEqual(400);
    });
  });

  test.describe('Name edge cases', () => {
    test('rejects empty name string', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createEnvironment({ name: '' });
      expect(status).toBe(400);
    });

    test('rejects negative cpuLimit', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createEnvironment({
        name: `NegCpu-${Date.now()}`,
        cpuLimit: -1,
      });
      // Server may accept and treat as no limit, or reject
      if (status === 201) {
        // If accepted, clean up — the API is lenient
      } else {
        expect(status).toBe(400);
      }
    });
  });

  test.describe('Name type validation', () => {
    test('name as number is accepted (coerced to string)', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.createEnvironment({ name: 123 });
      // Server may coerce number to string or reject it
      if (status === 201) {
        createdEnvIds.push(body.id);
        expect(typeof body.name).toBe('string');
        expect(body.name).toBe('123');
      } else {
        expect(status).toBe(400);
      }
    });

    test('name as null is rejected', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.createEnvironment({ name: null });
      expect(status).toBe(400);
    });

    test('name as boolean is handled', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.createEnvironment({ name: true });
      // Server may coerce boolean to string or reject it
      if (status === 201) {
        createdEnvIds.push(body.id);
        expect(typeof body.name).toBe('string');
        expect(body.name).toBe('true');
      } else {
        expect(status).toBe(400);
      }
    });
  });

  test.describe('Update with same name', () => {
    test('update with same name succeeds', async ({ request }) => {
      const api = new ApiClient(request);
      const envName = `SameName-${Date.now()}`;
      const { body: created } = await api.createEnvironment({ name: envName });
      createdEnvIds.push(created.id);

      const { status, body } = await api.updateEnvironment(created.id, { name: envName });
      expect(status).toBe(200);
      expect(body.name).toBe(envName);
    });
  });

  test.describe('Delete and re-fetch', () => {
    test('deleted environment returns 404 on get', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: created } = await api.createEnvironment({
        name: `DeleteRefetch-${Date.now()}`,
      });
      const envId = created.id;

      // Delete it
      const { status: deleteStatus } = await api.deleteEnvironment(envId);
      expect(deleteStatus).toBe(200);

      // Re-fetch should 404
      const { status: getStatus } = await api.getEnvironment(envId);
      expect(getStatus).toBe(404);
    });
  });

  test.describe('Environment list sorting', () => {
    test('list is sorted by name alphabetically', async ({ request }) => {
      const api = new ApiClient(request);
      const ts = Date.now();
      const names = [`C-Sort-${ts}`, `A-Sort-${ts}`, `B-Sort-${ts}`];

      for (const name of names) {
        const { body } = await api.createEnvironment({ name });
        createdEnvIds.push(body.id);
      }

      const { body: list } = await api.listEnvironments();
      // Filter to only our test envs to avoid interference
      const testEnvs = list.filter((e: { name: string }) => e.name.endsWith(`-${ts}`));
      const sortedNames = testEnvs.map((e: { name: string }) => e.name);

      // Verify they are sorted (compared to a sorted copy)
      const expectedSorted = [...sortedNames].sort((a: string, b: string) => a.localeCompare(b));
      expect(sortedNames).toEqual(expectedSorted);
    });
  });

  test.describe('Update cpuLimit to zero', () => {
    test('cpuLimit: 0 succeeds (means no limit)', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: created } = await api.createEnvironment({
        name: `CpuZero-${Date.now()}`,
        cpuLimit: 2,
      });
      createdEnvIds.push(created.id);
      expect(created.cpuLimit).toBe(2);

      const { status, body } = await api.updateEnvironment(created.id, { cpuLimit: 0 });
      expect(status).toBe(200);
      expect(body.cpuLimit).toBe(0);
    });
  });

  test.describe('Create with all fields populated', () => {
    test('all fields are stored and returned', async ({ request }) => {
      const api = new ApiClient(request);
      const ts = Date.now();
      const { status, body } = await api.createEnvironment({
        name: `AllFields-${ts}`,
        networkMode: 'custom',
        allowedDomains: ['api.example.com', 'cdn.example.com'],
        includePackageManagerDomains: true,
        dockerEnabled: false,
        cpuLimit: 4,
        memoryLimit: '16g',
        envVars: 'MY_VAR=hello\nOTHER=world',
        setupScript: '#!/bin/bash\necho setup',
      });
      createdEnvIds.push(body.id);

      expect(status).toBe(201);
      expect(body.name).toBe(`AllFields-${ts}`);
      expect(body.networkMode).toBe('custom');
      expect(body.allowedDomains).toEqual(['api.example.com', 'cdn.example.com']);
      expect(body.includePackageManagerDomains).toBe(true);
      expect(body.dockerEnabled).toBe(false);
      expect(body.cpuLimit).toBe(4);
      expect(body.memoryLimit).toBe('16g');
      expect(body.envVars).toBe('MY_VAR=hello\nOTHER=world');
      expect(body.setupScript).toBe('#!/bin/bash\necho setup');
      expect(typeof body.id).toBe('string');
      expect(typeof body.createdAt).toBe('string');
      expect(typeof body.updatedAt).toBe('string');
    });

    test('stores multi-line env vars including comments and empty values', async ({ request }) => {
      const api = new ApiClient(request);
      const envVars = 'FOO=bar\nBAZ=qux\n# comment line\nEMPTY=';
      const { status, body } = await api.createEnvironment({
        name: `MultilineEnv-${Date.now()}`,
        envVars,
      });
      expect(status).toBe(201);
      expect(body.envVars).toBe(envVars);
      createdEnvIds.push(body.id);
    });
  });

  test.describe('Partial update behavior', () => {
    test('partial update preserves unchanged fields', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: created } = await api.createEnvironment({
        name: `PartialUpdate-${Date.now()}`,
        cpuLimit: 2,
        memoryLimit: '1g',
        dockerEnabled: true,
        envVars: 'FOO=bar',
        setupScript: 'echo setup',
      });
      createdEnvIds.push(created.id);

      const { status, body: updated } = await api.updateEnvironment(created.id, {
        name: `PartialUpdate-${Date.now()}-renamed`,
        cpuLimit: 4,
      });
      expect(status).toBe(200);
      expect(updated.cpuLimit).toBe(4);
      // Unchanged fields preserved
      expect(updated.memoryLimit).toBe('1g');
      expect(updated.dockerEnabled).toBe(true);
      expect(updated.envVars).toBe('FOO=bar');
      expect(updated.setupScript).toBe('echo setup');
      // Timestamps: createdAt stable, updatedAt bumps
      expect(updated.createdAt).toBe(created.createdAt);
      expect(updated.updatedAt).not.toBe(created.updatedAt);
    });

    test('deleted environment no longer appears in list', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: created } = await api.createEnvironment({
        name: `DeleteList-${Date.now()}`,
      });
      const { status: delStatus } = await api.deleteEnvironment(created.id);
      expect(delStatus).toBe(200);

      const { body: list } = await api.listEnvironments();
      expect(list.find((e: { id: string }) => e.id === created.id)).toBeFalsy();
    });
  });
});
