import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // See vite.config.ts for why these are aliased directly to the committed dist.
      '@dosya-dev/e2ee-core': path.resolve(__dirname, '../../packages/e2ee-core/dist/index.js'),
      '@dosya-dev/e2ee-client': path.resolve(__dirname, '../../packages/e2ee-client/dist/index.js'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
