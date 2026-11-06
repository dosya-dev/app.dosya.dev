import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import path from 'path'
import { execSync } from 'node:child_process'

// Source maps go to Sentry only when SENTRY_AUTH_TOKEN is set (a hand deploy
// from a machine holding the token, or CI) - never from a stray
// ~/.sentryclirc. Then, and only then, the build emits hidden maps, uploads
// them keyed by debug id, and deletes them so dist/ ships no source. A failed
// upload is a warning, not a failed build: the bundle is still correct, only
// symbolication is lost. No release name is set: the plugin injects the git
// SHA and debug ids do the matching.
const SENTRY_UPLOAD = Boolean(process.env.SENTRY_AUTH_TOKEN)

// The build the user is running, for bug reports. Cloudflare Pages exposes the
// commit; a local `vite build` asks git; vitest and odd environments get 'dev'.
function buildSha(): string {
  if (process.env.CF_PAGES_COMMIT_SHA) return process.env.CF_PAGES_COMMIT_SHA.slice(0, 8);
  try { return execSync('git rev-parse --short=8 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'dev'; }
  catch { return 'dev'; }
}

export default defineConfig({
  define: {
    __BUILD_SHA__: JSON.stringify(buildSha()),
  },
  plugins: [
    react(),
    tailwindcss(),
    ...(SENTRY_UPLOAD
      ? [
          sentryVitePlugin({
            org: 'dosya-pty-ltd',
            project: 'dosya-web',
            url: 'https://de.sentry.io/',
            authToken: process.env.SENTRY_AUTH_TOKEN,
            telemetry: false,
            errorHandler: (err) => console.warn(`::warning::Sentry source-map upload failed: ${err.message}`),
            sourcemaps: { filesToDeleteAfterUpload: [path.resolve(__dirname, 'dist/**/*.map')] },
          }),
        ]
      : []),
  ],
  build: {
    sourcemap: SENTRY_UPLOAD ? 'hidden' : false,
    rollupOptions: {
      // The app, and the face reader page the mobile app loads in a hidden
      // WebView for on-device Personas (src/personas-reader/main.ts): Hermes
      // cannot run WebAssembly, so the phone reads faces through this page.
      input: {
        // `index` keeps the app's entry chunk named index-*.js, as before.
        index: path.resolve(__dirname, 'index.html'),
        'personas-reader': path.resolve(__dirname, 'personas-reader.html'),
      },
    },
  },
  worker: {
    // The client-side HEIC decoder is a Web Worker that dynamically imports a
    // ~1.5MB libheif WASM chunk. Default worker format is 'iife', which forces
    // Rollup to disable code splitting for worker chunks - that would inline the
    // decoder into heic.worker's own chunk, so every browser that spawns the
    // worker (including Safari, which decodes HEIC natively) would download it
    // upfront. 'es' keeps code splitting intact so the decoder is only fetched
    // when a browser actually needs to decode a HEIC the server couldn't.
    format: 'es',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // NOTE: don't alias @pqina/* to ../../node_modules - that path only exists in the
      // monorepo (hoisted) and points outside the standalone deploy repo, breaking the CF
      // build. Standard resolution finds pintura in both layouts.
      //
      // The e2ee packages are VENDORED into apps/web/vendor (see
      // scripts/vendor-e2ee.mjs) - a self-contained, bundled ESM index.js each
      // (all third-party deps - libsodium-wrappers-sumo, @hpke/core,
      // @hpke/chacha20poly1305, @cloudflare/voprf-ts - inlined by esbuild;
      // e2ee-client imports e2ee-core rather than inlining it, so BOTH aliases
      // below are load-bearing - a client with no core alias resolves to a
      // second copy of the registry and the installed backend is not found).
      // They MUST live inside apps/web:
      // CI (sync-public-repos.yml → sync-web) pushes only apps/web/ to the
      // deploy repo Cloudflare Pages builds, so any ../../packages/* reference
      // escapes that repo and fails to resolve. Alias to the in-tree vendor copy
      // so a plain `npm ci && tsc -b && vite build` needs nothing outside apps/web.
      '@dosya-dev/e2ee-core': path.resolve(__dirname, './vendor/e2ee-core/index.js'),
      '@dosya-dev/e2ee-client': path.resolve(__dirname, './vendor/e2ee-client/index.js'),
      // On-device Personas (scripts/vendor-personas.mjs): the engine bundle,
      // which imports @dosya-dev/e2ee-core and so shares the alias above, and
      // the face reader's wasm-bindgen glue (the wasm itself is fetched).
      '@dosya-dev/personas-engine': path.resolve(__dirname, './vendor/personas-engine/index.js'),
      '@dosya-dev/face-reader': path.resolve(__dirname, './vendor/face-reader/face_reader.js'),
      '@dosya-dev/onnxruntime-web': path.resolve(__dirname, './vendor/onnxruntime-web/ort.webgpu.bundle.min.mjs'),
      // Vendored for the same reason (scripts/vendor-audio-player.mjs), but as
      // plain source rather than a bundled dist - the package has no build step
      // and no third-party dependency.
      '@dosya-dev/audio-player': path.resolve(__dirname, './vendor/audio-player/index.ts'),
      // Same again (scripts/vendor-video-player.mjs). Its one dependency,
      // video.js, is an apps/web dependency. Longer keys first: Vite matches
      // aliases in order, and the bare key is a prefix of the subpaths.
      '@dosya-dev/video-player/react': path.resolve(__dirname, './vendor/video-player/react.tsx'),
      '@dosya-dev/video-player/skin.css': path.resolve(__dirname, './vendor/video-player/skin.css'),
      '@dosya-dev/video-player': path.resolve(__dirname, './vendor/video-player/index.ts'),
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
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:4322',
        // The live chat panel opens a WebSocket on /api/support/chat/socket;
        // without this the dev proxy answers the upgrade with a plain 404.
        ws: true,
        changeOrigin: true,
        cookieDomainRewrite: { '*': '' },
        configure: (proxy) => {
          // The API only trusts its own origins. Against a production BUILD of
          // the worker (wrangler dev) the dev origins are compiled out, so set
          // VITE_API_PROXY_ORIGIN=https://app.dosya.dev for that case.
          const origin = process.env.VITE_API_PROXY_ORIGIN || 'http://localhost:5173';
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Origin', origin);
          });
          proxy.on('proxyReqWs', (proxyReq) => {
            proxyReq.setHeader('Origin', origin);
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
