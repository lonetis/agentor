import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { cleanupAllEnvironments } from '../helpers/worker-lifecycle';

test.describe('Environments API — Advanced', () => {
  test.afterEach(async ({ request }) => {
    await cleanupAllEnvironments(request);
  });

  test.describe('Network modes', () => {
    const networkModes = ['full', 'block', 'block-all', 'package-managers', 'custom'] as const;

    for (const mode of networkModes) {
      test(`creates environment with ${mode} network mode`, async ({ request }) => {
        const api = new ApiClient(request);
        const { status, body } = await api.createEnvironment({
          name: `test-${mode}`,
          cpuLimit: 0,
          memoryLimit: '',
          networkMode: mode,
          allowedDomains: mode === 'custom' ? ['example.com'] : [],
          includePackageManagerDomains: mode === 'custom',
          dockerEnabled: true,
          envVars: '',
          setupScript: '',
          initScript: '',
        });
        expect(status).toBe(201);
        expect(body.networkMode).toBe(mode);
        expect(body.id).toBeTruthy();
      });
    }
  });

  test.describe('Custom environment variables', () => {
    test('stores multi-line env vars', async ({ request }) => {
      const api = new ApiClient(request);
      const envVars = 'FOO=bar\nBAZ=qux\n# comment line\nEMPTY=';
      const { status, body } = await api.createEnvironment({
        name: 'test-envvars',
        cpuLimit: 2,
        memoryLimit: '512m',
        networkMode: 'full',
        allowedDomains: [],
        includePackageManagerDomains: false,
        dockerEnabled: false,
        envVars,
        setupScript: '',
        initScript: '',
      });
      expect(status).toBe(201);
      expect(body.envVars).toBe(envVars);
    });
  });

  test.describe('Update environment', () => {
    test('partial update preserves unchanged fields', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: created } = await api.createEnvironment({
        name: 'test-update',
        cpuLimit: 2,
        memoryLimit: '1g',
        networkMode: 'full',
        allowedDomains: [],
        includePackageManagerDomains: false,
        dockerEnabled: true,
        envVars: 'FOO=bar',
        setupScript: 'echo setup',
        initScript: 'echo init',
      });

      const { status, body: updated } = await api.updateEnvironment(created.id, {
        name: 'test-update-renamed',
        cpuLimit: 4,
      });
      expect(status).toBe(200);
      expect(updated.name).toBe('test-update-renamed');
      expect(updated.cpuLimit).toBe(4);
      // Unchanged fields preserved
      expect(updated.memoryLimit).toBe('1g');
      expect(updated.dockerEnabled).toBe(true);
      expect(updated.envVars).toBe('FOO=bar');
      // Timestamps
      expect(updated.createdAt).toBe(created.createdAt);
      expect(updated.updatedAt).not.toBe(created.updatedAt);
    });

    test('update non-existent environment returns 404', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.updateEnvironment('non-existent-id', {
        name: 'does-not-exist',
      });
      expect(status).toBeGreaterThanOrEqual(400);
    });
  });

  test.describe('Delete environment', () => {
    test('delete non-existent environment returns error', async ({ request }) => {
      const api = new ApiClient(request);
      const { status } = await api.deleteEnvironment('non-existent-id');
      expect(status).toBeGreaterThanOrEqual(400);
    });

    test('deleted environment no longer appears in list', async ({ request }) => {
      const api = new ApiClient(request);
      const { body: created } = await api.createEnvironment({
        name: 'test-delete',
        cpuLimit: 0,
        memoryLimit: '',
        networkMode: 'full',
        allowedDomains: [],
        includePackageManagerDomains: false,
        dockerEnabled: true,
        envVars: '',
        setupScript: '',
        initScript: '',
      });

      const { status: delStatus } = await api.deleteEnvironment(created.id);
      expect(delStatus).toBe(200);

      const { body: list } = await api.listEnvironments();
      const found = list.find((e: { id: string }) => e.id === created.id);
      expect(found).toBeFalsy();
    });
  });

  test.describe('Resource limits', () => {
    test('stores CPU and memory limits', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.createEnvironment({
        name: 'test-limits',
        cpuLimit: 4.5,
        memoryLimit: '2g',
        networkMode: 'full',
        allowedDomains: [],
        includePackageManagerDomains: false,
        dockerEnabled: false,
        envVars: '',
        setupScript: '',
        initScript: '',
      });
      expect(status).toBe(201);
      expect(body.cpuLimit).toBe(4.5);
      expect(body.memoryLimit).toBe('2g');
    });
  });
});
