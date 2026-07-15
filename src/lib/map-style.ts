import { API_BASE } from '@/api/client';
import { layers, namedTheme } from 'protomaps-themes-base';
import type { StyleSpecification } from 'maplibre-gl';

// The big vector basemap streams from R2 via our own API (range requests) — see
// apps/api/.../map/basemap.ts. Fonts + sprite are generic public assets (not user data),
// so they are served as same-origin static files from the web app's own /public dir
// (apps/web/public/map-assets/). Everything is first-party → zero external calls.
export const BASEMAP_URL = `pmtiles://${API_BASE}/api/map/basemap`;
const GLYPHS_URL = `/map-assets/fonts/{fontstack}/{range}.pbf`;
const SPRITE_URL = `/map-assets/sprites`; // MapLibre appends /{flavor}.json + .png

export function buildMapStyle(dark: boolean): StyleSpecification {
  const flavor = dark ? 'dark' : 'light';
  return {
    version: 8,
    glyphs: GLYPHS_URL,
    sprite: `${SPRITE_URL}/${flavor}`,
    sources: {
      protomaps: {
        type: 'vector',
        url: BASEMAP_URL,
        attribution: '© OpenStreetMap contributors',
      },
    },
    // protomaps-themes-base ^4 exports named `layers(source, theme, options)` +
    // `namedTheme(name)` — the older default-export `layers('protomaps', 'light')`
    // 2-arg shape (assumed by the original plan) no longer exists in this version.
    // `{ lang: 'en' }` includes place/road labels; omitting it would render an
    // unlabeled basemap (layers() only adds label layers when `lang` is given).
    layers: layers('protomaps', namedTheme(flavor), { lang: 'en' }) as StyleSpecification['layers'],
  };
}
