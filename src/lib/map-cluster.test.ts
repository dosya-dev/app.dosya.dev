import { describe, it, expect } from 'vitest';
import { pinsToFeatures, buildClusterIndex, clustersInView } from './map-cluster';

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
});
