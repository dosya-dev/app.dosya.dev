import { describe, it, expect } from 'vitest';
import { pinsToFeatures, buildClusterIndex, clustersInView, viewportBboxes } from './map-cluster';

const pins = [
  { id: 'a', latitude: 41.900, longitude: 12.490 }, // Rome
  { id: 'b', latitude: 41.901, longitude: 12.491 }, // Rome (next to a)
  { id: 'c', latitude: -33.860, longitude: 151.200 }, // Sydney (far)
];
const WORLD: [number, number, number, number] = [-180, -85, 180, 85];

describe('pinsToFeatures', () => {
  it('emits GeoJSON points in [lon, lat] order with the pin id', () => {
    const f = pinsToFeatures([{ id: 'a', latitude: 41.9, longitude: 12.5 }])[0];
    expect(f.geometry.coordinates).toEqual([12.5, 41.9]);
    expect(f.properties.pinId).toBe('a');
  });
});

describe('clustersInView', () => {
  it('clusters nearby pins at low zoom', () => {
    const index = buildClusterIndex(pinsToFeatures(pins));
    const items = clustersInView(index, WORLD, 1);
    const clusters = items.filter((i) => i.kind === 'cluster');
    const singles = items.filter((i) => i.kind === 'pin');
    expect(clusters).toHaveLength(1);
    expect((clusters[0] as any).count).toBe(2);      // a + b
    expect(singles).toHaveLength(1);                 // c alone
    expect((singles[0] as any).pinId).toBe('c');
    expect((clusters[0] as any).expansionZoom).toBeGreaterThan(1);
  });

  it('separates the same pins into individual markers at high zoom', () => {
    const index = buildClusterIndex(pinsToFeatures(pins));
    const romeBbox: [number, number, number, number] = [12.48, 41.89, 12.50, 41.91];
    const items = clustersInView(index, romeBbox, 18);
    expect(items.every((i) => i.kind === 'pin')).toBe(true);
    expect(items).toHaveLength(2);
  });

  it('accepts several bboxes and never returns the same marker twice', () => {
    const index = buildClusterIndex(pinsToFeatures(pins));
    // Two halves of the world, meeting at 0. Rome (12.49E) sits in the east
    // half only, so a naive concat would still be fine - what this guards is
    // the antimeridian split handing overlapping ranges to the index.
    const items = clustersInView(index, [[-180, -85, 180, 85], [0, -85, 180, 85]], 1);
    const keys = items.map((i) => (i.kind === 'cluster' ? `c${i.id}` : `p${i.pinId}`));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps pins that share one exact coordinate clustered, however far you zoom', () => {
    // Every file uploaded from one IP gets the SAME fallback coordinate, so a
    // 2000-photo upload is 2000 identical points. Past the index's maxZoom
    // supercluster stops clustering and returns every one of them, which meant
    // 2000 stacked markers (and 2000 image requests) on a single pixel.
    const stacked = Array.from({ length: 500 }, (_, i) => ({
      id: `s${i}`, latitude: -27.4698, longitude: 153.0251,
    }));
    const index = buildClusterIndex(pinsToFeatures(stacked));
    for (const zoom of [16, 17, 18, 20, 22]) {
      const items = clustersInView(index, [[152, -28, 154, -27]], zoom);
      expect(items).toHaveLength(1);
      expect(items[0].kind).toBe('cluster');
      expect((items[0] as any).count).toBe(500);
    }
  });

  it('marks a cluster that cannot be split apart as not expandable', () => {
    const stacked = Array.from({ length: 10 }, (_, i) => ({
      id: `s${i}`, latitude: 10, longitude: 10,
    }));
    const index = buildClusterIndex(pinsToFeatures(stacked));
    const [item] = clustersInView(index, [[9, 9, 11, 11]], 16);
    expect(item.kind).toBe('cluster');
    // Zooming in cannot separate identical coordinates, so the UI must do
    // something other than easeTo() into a view that looks unchanged.
    expect((item as any).expandable).toBe(false);
  });

  it('marks a genuinely separable cluster as expandable', () => {
    const index = buildClusterIndex(pinsToFeatures(pins));
    const [cluster] = clustersInView(index, [[12.4, 41.8, 12.6, 42.0]], 1)
      .filter((i) => i.kind === 'cluster');
    expect((cluster as any).expandable).toBe(true);
  });
});

describe('viewportBboxes', () => {
  it('passes an ordinary viewport straight through', () => {
    expect(viewportBboxes({ west: 12.4, south: 41.8, east: 12.6, north: 42.0 }))
      .toEqual([[12.4, 41.8, 12.6, 42.0]]);
  });

  it('clamps latitude to the Web Mercator limit', () => {
    const [b] = viewportBboxes({ west: -10, south: -89, east: 10, north: 89 });
    expect(b[1]).toBe(-85);
    expect(b[3]).toBe(85);
  });

  it('wraps a viewport that has drifted into the next world copy', () => {
    // Pan east past the antimeridian: MapLibre keeps counting past 180.
    const [[west, south, east, north]] = viewportBboxes({
      west: 372.4, south: 41.8, east: 372.6, north: 42.0,
    });
    expect(west).toBeCloseTo(12.4, 10); // 372.4 - 360 is not exactly 12.4 in binary float
    expect(east).toBeCloseTo(12.6, 10);
    expect([south, north]).toEqual([41.8, 42.0]);
  });

  it('splits a viewport straddling the antimeridian into two ranges', () => {
    const boxes = viewportBboxes({ west: 170, south: -10, east: 190, north: 10 });
    expect(boxes).toHaveLength(2);
    expect(boxes).toContainEqual([170, -10, 180, 10]);
    expect(boxes).toContainEqual([-180, -10, -170, 10]);
  });

  it('collapses to the whole world once the viewport spans a full turn', () => {
    // Zoomed far out, the visible span exceeds 360 and wrapping is meaningless.
    expect(viewportBboxes({ west: -200, south: -80, east: 200, north: 80 }))
      .toEqual([[-180, -80, 180, 80]]);
  });

  it('is bounded: never returns a range outside [-180, 180]', () => {
    for (const west of [-540, -181, -0.5, 179.9, 359, 720]) {
      for (const boxes of [viewportBboxes({ west, south: -5, east: west + 30, north: 5 })]) {
        for (const [w, , e] of boxes) {
          expect(w).toBeGreaterThanOrEqual(-180);
          expect(e).toBeLessThanOrEqual(180);
          expect(w).toBeLessThanOrEqual(e);
        }
      }
    }
  });
});
