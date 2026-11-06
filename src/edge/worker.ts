/**
 * The app.dosya.dev Worker: the static Vite build served from Workers
 * static assets (wrangler.toml), with this script for one case only.
 *
 * The asset layer answers everything it can without running this code:
 * every file in dist, and every NAVIGATION to a path that is not a file
 * (not_found_handling = "single-page-application" serves index.html, which
 * the client router takes from there). This script runs only for a
 * non-navigation request that matched no file.
 *
 * That case is why it exists. On Pages, `/* /index.html 200` answered a
 * missing hashed chunk with index.html, and `/assets/*` carries
 * `immutable, max-age=31536000` (public/_headers), so the edge cached HTML
 * as the chunk for a year: a request racing a deploy poisoned that PoP
 * (2026-10-13, assets/uploads-*.js). A missing file under /assets/ is now a
 * 404 that nothing caches. Anything else keeps the SPA answer it had.
 */

export interface Env {
    ASSETS: { fetch(request: Request): Promise<Response> };
}

export async function handle(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/assets/")) {
        return new Response("Not found", {
            status: 404,
            headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
        });
    }
    return env.ASSETS.fetch(request);
}

export default { fetch: handle };
