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
      // packages/e2ee-core and packages/e2ee-client build to a fully self-contained,
      // bundled ESM dist/index.js (all third-party deps — libsodium-wrappers-sumo,
      // @hpke/core, @hpke/chacha20poly1305, @cloudflare/voprf-ts — inlined by esbuild;
      // e2ee-client's dist also inlines e2ee-core). Alias both directly to that
      // committed dist so resolution is deterministic regardless of node_modules
      // layout — a plain `npm ci && tsc -b && vite build` needs nothing else.
      '@dosya-dev/e2ee-core': path.resolve(__dirname, '../../packages/e2ee-core/dist/index.js'),
      '@dosya-dev/e2ee-client': path.resolve(__dirname, '../../packages/e2ee-client/dist/index.js'),
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
