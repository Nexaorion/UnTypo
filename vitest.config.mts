import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      reporter: ['text', 'html'],
    },
    exclude: ['tests/performance/**'],
    include: ['tests/**/*.test.ts'],
  },
});
