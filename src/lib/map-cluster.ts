import Supercluster, { type PointFeature } from 'supercluster';

export type PinPointProps = { pinId: string };
export type PinFeature = PointFeature<PinPointProps>;

export function pinsToFeatures(
  pins: { id: string; latitude: number; longitude: number }[],
): PinFeature[] {
  return pins.map((p) => ({
    type: 'Feature',
    properties: { pinId: p.id },
    geometry: { type: 'Point', coordinates: [p.longitude, p.latitude] },
  }));
}

export function buildClusterIndex(features: PinFeature[]): Supercluster<PinPointProps> {
  const index = new Supercluster<PinPointProps>({ radius: 60, maxZoom: 16 });
  index.load(features);
  return index;
}

export type ViewItem =
  | { kind: 'cluster'; id: number; count: number; lon: number; lat: number; expansionZoom: number; sampleIds: string[] }
  | { kind: 'pin'; pinId: string; lon: number; lat: number };

export function clustersInView(
  index: Supercluster<PinPointProps>,
  bbox: [number, number, number, number],
  zoom: number,
): ViewItem[] {
  return index.getClusters(bbox, Math.round(zoom)).map((f) => {
    const [lon, lat] = f.geometry.coordinates as [number, number];
    const props = f.properties as PinPointProps & { cluster?: boolean; cluster_id?: number; point_count?: number };
    if (props.cluster) {
      const id = props.cluster_id as number;
      // A few representative leaf ids so the marker can show a cover photo (Apple-style).
      const sampleIds = (index.getLeaves(id, 6) as PinFeature[]).map((l) => l.properties.pinId);
      return {
        kind: 'cluster',
        id,
        count: props.point_count as number,
        lon,
        lat,
        expansionZoom: Math.min(index.getClusterExpansionZoom(id), 20),
        sampleIds,
      };
    }
    return { kind: 'pin', pinId: props.pinId, lon, lat };
  });
}
