import { defineConfig, devices } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: '.',
  testMatch: ['api/**/*.spec.ts', 'ui/**/*.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 2,
  workers: process.env.CI ? 1 : 8,
  globalSetup: './global-setup.ts',
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: BASE_URL,
    // better-auth enforces an Origin header on mutating requests. Set it
    // globally so every fixture-provided `request` context passes it.
    extraHTTPHeaders: {
      Origin: BASE_URL,
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'api',
      testMatch: 'api/**/*.spec.ts',
      use: {
        storageState: resolve(__dirname, '.auth/admin-api.json'),
      },
    },
    {
      name: 'ui',
      testMatch: 'ui/**/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
        storageState: resolve(__dirname, '.auth/admin-ui.json'),
      },
    },
  ],
});
