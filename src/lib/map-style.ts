import { API_BASE } from '@/api/client';
import type { StyleSpecification } from 'maplibre-gl';

// The vector basemap streams from R2 via our own API (range requests) — see
// apps/api/.../map/basemap.ts. It's a Protomaps-schema .pmtiles (whole world,
// z0-7). We render it with a small hand-written geometry style (no fonts/sprite,
// no external theme dependency) — validated to render cleanly with zero errors.
// Text labels are a future add-on (would need self-hosted glyph fonts).
export const BASEMAP_URL = `pmtiles://${API_BASE}/api/map/basemap`;

/**
 * A self-contained style with NO external references — just a solid background.
 * Used before the basemap is confirmed available, so the map renders a clean
 * empty canvas with pins instead of throwing on missing tiles.
 */
function emptyStyle(dark: boolean): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': dark ? '#0f1720' : '#e7ebef' } }],
  };
}

/**
 * Probe whether the basemap PMTiles is actually in R2 (a tiny ranged GET). When
 * it isn't, `buildMapStyle` falls back to `emptyStyle` so the page never tries
 * to load a nonexistent basemap.
 */
export async function checkBasemapAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/map/basemap`, { headers: { Range: 'bytes=0-0' } });
    return res.ok; // 200/206 when the .pmtiles exists; 404 when not provisioned
  } catch {
    return false;
  }
}

type Palette = { water: string; earth: string; landuse: string; roads: string; boundaries: string };
const LIGHT: Palette = { water: '#a9d3e8', earth: '#e7e2d8', landuse: '#e2e8d5', roads: '#ffffff', boundaries: '#9aa0a6' };
const DARK: Palette = { water: '#12283b', earth: '#22303f', landuse: '#26364a', roads: '#3a4d63', boundaries: '#46596e' };

export function buildMapStyle(dark: boolean, hasBasemap = false): StyleSpecification {
  if (!hasBasemap) return emptyStyle(dark);
  const c = dark ? DARK : LIGHT;
  // Geometry-only layers against the Protomaps schema (earth/landuse/water/roads/
  // boundaries). No `symbol` layers → no glyph/sprite fetches → no label errors.
  return {
    version: 8,
    sources: {
      protomaps: { type: 'vector', url: BASEMAP_URL, attribution: '© OpenStreetMap' },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': c.water } },
      { id: 'earth', type: 'fill', source: 'protomaps', 'source-layer': 'earth', paint: { 'fill-color': c.earth } },
      { id: 'landuse', type: 'fill', source: 'protomaps', 'source-layer': 'landuse', paint: { 'fill-color': c.landuse } },
      { id: 'water', type: 'fill', source: 'protomaps', 'source-layer': 'water', paint: { 'fill-color': c.water } },
      { id: 'roads', type: 'line', source: 'protomaps', 'source-layer': 'roads', paint: { 'line-color': c.roads, 'line-width': 0.7 } },
      { id: 'boundaries', type: 'line', source: 'protomaps', 'source-layer': 'boundaries', paint: { 'line-color': c.boundaries, 'line-width': 0.5 } },
    ] as StyleSpecification['layers'],
  };
}
