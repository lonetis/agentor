import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: '.',
    include: ['server/__tests__/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['server/utils/**'],
      exclude: ['shared/types.ts'],
      reporter: ['text', 'html', 'lcov'],
    },
  },
});
