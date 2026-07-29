import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // See vite.config.ts for why these resolve to the in-tree vendored bundle.
      '@dosya-dev/e2ee-core': path.resolve(__dirname, './vendor/e2ee-core/index.js'),
      '@dosya-dev/e2ee-client': path.resolve(__dirname, './vendor/e2ee-client/index.js'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
