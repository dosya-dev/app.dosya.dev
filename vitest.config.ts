import { defineConfig, coverageConfigDefaults } from 'vitest/config';
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
    // TurnstileWidget deliberately renders nothing when no sitekey is
    // configured, and .env is gitignored so CI has none - without this the
    // widget's own tests would silently exercise the skip path and fail on a
    // render() that never happened. Cloudflare's public always-passes test
    // sitekey keeps the real render path under test everywhere.
    env: {
      VITE_TURNSTILE_SITEKEY: '1x00000000000000000000AA',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      reportsDirectory: './coverage',
      // Without this, vitest's exclude list only filters the untested-file
      // glob; raw V8 process coverage passes straight into the report
      // unfiltered - this is what let vendor/e2ee-* leak in as "covered".
      excludeAfterRemap: true,
      // Positive filter: only first-party source under src/ counts. vendor/
      // holds the in-tree e2ee-core/e2ee-client bundle (see the alias above)
      // - it must never count toward coverage, since re-vendoring it would
      // move the number without a single test changing.
      include: ['src/**'],
      exclude: [
        ...coverageConfigDefaults.exclude,
        '**/*.test.ts',
        '**/*.unit.test.ts',
        '**/*.int.test.ts',
        '**/test-stubs/**',
        '**/dist/**',
        '**/vendor/**',
        '**/node_modules/**',
        '**/*.config.ts',
      ],
    },
  },
});
