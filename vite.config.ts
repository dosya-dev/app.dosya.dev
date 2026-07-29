import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: {
    // The client-side HEIC decoder is a Web Worker that dynamically imports a
    // ~1.5MB libheif WASM chunk. Default worker format is 'iife', which forces
    // Rollup to disable code splitting for worker chunks — that would inline the
    // decoder into heic.worker's own chunk, so every browser that spawns the
    // worker (including Safari, which decodes HEIC natively) would download it
    // upfront. 'es' keeps code splitting intact so the decoder is only fetched
    // when a browser actually needs to decode a HEIC the server couldn't.
    format: 'es',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // NOTE: don't alias @pqina/* to ../../node_modules — that path only exists in the
      // monorepo (hoisted) and points outside the standalone deploy repo, breaking the CF
      // build. Standard resolution finds pintura in both layouts.
      //
      // The e2ee packages are VENDORED into apps/web/vendor (see
      // scripts/vendor-e2ee.mjs) — a self-contained, bundled ESM index.js each
      // (all third-party deps — libsodium-wrappers-sumo, @hpke/core,
      // @hpke/chacha20poly1305, @cloudflare/voprf-ts — inlined by esbuild;
      // e2ee-client also inlines e2ee-core). They MUST live inside apps/web:
      // CI (sync-public-repos.yml → sync-web) pushes only apps/web/ to the
      // deploy repo Cloudflare Pages builds, so any ../../packages/* reference
      // escapes that repo and fails to resolve. Alias to the in-tree vendor copy
      // so a plain `npm ci && tsc -b && vite build` needs nothing outside apps/web.
      '@dosya-dev/e2ee-core': path.resolve(__dirname, './vendor/e2ee-core/index.js'),
      '@dosya-dev/e2ee-client': path.resolve(__dirname, './vendor/e2ee-client/index.js'),
    },
  },
  server: {
    fs: {
      // Only allow serving files from apps/web and the pintura packages
      allow: ['.', '../../node_modules/@pqina'],
      strict: true,
    },
    proxy: {
      '/api': {
        target: 'http://localhost:4322',
        changeOrigin: true,
        cookieDomainRewrite: { '*': '' },
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Origin', 'http://localhost:5173');
          });
          // Rewrite Set-Cookie to work on the proxy's port
          proxy.on('proxyRes', (proxyRes) => {
            const cookies = proxyRes.headers['set-cookie'];
            if (cookies) {
              proxyRes.headers['set-cookie'] = cookies.map((cookie: string) =>
                cookie.replace(/;\s*Secure/gi, '').replace(/;\s*Domain=[^;]*/gi, '')
              );
            }
          });
        },
      },
    },
  },
})
