import { API_BASE } from '@/api/client';
import { layers, namedTheme } from 'protomaps-themes-base';
import type { StyleSpecification } from 'maplibre-gl';

// The big vector basemap streams from R2 via our own API (range requests) — see
// apps/api/.../map/basemap.ts. Fonts + sprite are generic public assets (not user data),
// so they are served as same-origin static files from the web app's own /public dir
// (apps/web/public/map-assets/). Everything is first-party → zero external calls.
//
// MapLibre requires the `sprite` URL to be ABSOLUTE (scheme + host); a root-relative
// "/map-assets/..." throws "Invalid sprite URL". Build absolute same-origin URLs from
// window.location.origin (falls back to '' during SSR/tests, where the map never renders).
const ASSET_ORIGIN = typeof window !== 'undefined' ? window.location.origin : '';
export const BASEMAP_URL = `pmtiles://${API_BASE}/api/map/basemap`;
const GLYPHS_URL = `${ASSET_ORIGIN}/map-assets/fonts/{fontstack}/{range}.pbf`;
const SPRITE_URL = `${ASSET_ORIGIN}/map-assets/sprites`; // MapLibre appends /{flavor}.json + .png

/**
 * A self-contained style with NO external references (no PMTiles source, no
 * sprite, no glyphs) — just a solid background. Used when the basemap asset
 * isn't provisioned yet, so the map renders a clean empty canvas with pins
 * instead of throwing on missing sprite/tile fetches. (The SPA serves
 * index.html for any missing static path, so a missing sprite JSON would
 * otherwise parse HTML as JSON and throw.)
 */
function emptyStyle(dark: boolean): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': dark ? '#0f1720' : '#e7ebef' } }],
  };
}

/**
 * Probe whether the basemap PMTiles is actually available in R2 (a tiny ranged
 * GET). When it isn't, `buildMapStyle` falls back to `emptyStyle` so the page
 * never tries to load a nonexistent sprite/glyphs/tiles.
 */
export async function checkBasemapAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/map/basemap`, { headers: { Range: 'bytes=0-0' } });
    return res.ok; // 200/206 when the .pmtiles exists; 404 when not provisioned
  } catch {
    return false;
  }
}

export function buildMapStyle(dark: boolean, hasBasemap = false): StyleSpecification {
  if (!hasBasemap) return emptyStyle(dark);
  const flavor = dark ? 'dark' : 'light';
  return {
    version: 8,
    // NB: no `glyphs`/`sprite` here on purpose. We self-host only the vector
    // .pmtiles; the fonts/sprite assets aren't provisioned. Omitting `{ lang }`
    // below yields a geometry-only basemap (land/water/roads/boundaries, no text
    // labels), so no glyph/sprite fetch happens — nothing can 404 into an
    // HTML-parse error. Add glyphs/sprite + `{ lang: 'en' }` later to enable labels.
    sources: {
      protomaps: {
        type: 'vector',
        url: BASEMAP_URL,
        attribution: '© OpenStreetMap contributors',
      },
    },
    // protomaps-themes-base ^4: `layers(source, namedTheme(name))`. Without the
    // options `{ lang }` arg, only geometry layers are emitted (no label layers).
    layers: layers('protomaps', namedTheme(flavor)) as StyleSpecification['layers'],
  };
}
